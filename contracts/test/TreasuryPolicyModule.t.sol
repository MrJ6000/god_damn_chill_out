// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Test.sol";
import "../src/TreasuryPolicyModule.sol";
import "./mocks/MockUSDC.sol";

contract TreasuryPolicyModuleTest is Test {
    TreasuryPolicyModule module;
    MockUSDC usdc;

    address root = address(0xC0FFEE);
    address aiSession = address(0xA1);
    address vendor = address(0xBEEF);
    address strangerAddr = address(0xDEAD);

    uint256 constant PER_TX_LIMIT = 5000 * 1e6;
    uint256 constant DAILY_LIMIT = 10000 * 1e6;
    uint256 constant APPROVAL_THRESHOLD = 2000 * 1e6;
    uint256 sessionExpiry;

    function setUp() public {
        sessionExpiry = block.timestamp + 7 days;
        usdc = new MockUSDC();

        module = new TreasuryPolicyModule(
            root,
            aiSession,
            address(usdc),
            PER_TX_LIMIT,
            DAILY_LIMIT,
            APPROVAL_THRESHOLD,
            sessionExpiry
        );

        usdc.mint(address(module), 1_000_000 * 1e6);

        vm.prank(root);
        module.setAllowedRecipient(vendor, true);
    }

    function testRootCanUpdatePolicy() public {
        vm.prank(root);
        module.setPerTxLimit(1000 * 1e6);
        assertEq(module.perTxLimit(), 1000 * 1e6);
    }

    function testAiCannotRaiseLimits() public {
        vm.prank(aiSession);
        vm.expectRevert(TreasuryPolicyModule.NotRoot.selector);
        module.setPerTxLimit(1_000_000 * 1e6);
    }

    function testAiCannotRaiseDailyLimit() public {
        vm.prank(aiSession);
        vm.expectRevert(TreasuryPolicyModule.NotRoot.selector);
        module.setDailyLimit(1_000_000 * 1e6);
    }

    function testAllowedTransferSucceeds() public {
        vm.prank(aiSession);
        bool ok = module.aiTransfer(address(usdc), vendor, 1000 * 1e6, keccak256("INV-1"));
        assertTrue(ok);
        assertEq(usdc.balanceOf(vendor), 1000 * 1e6);
    }

    function testUnknownRecipientReverts() public {
        vm.prank(aiSession);
        vm.expectRevert(
            abi.encodeWithSelector(TreasuryPolicyModule.RecipientNotAllowed.selector, strangerAddr)
        );
        module.aiTransfer(address(usdc), strangerAddr, 1000 * 1e6, keccak256("INV-2"));
    }

    function testOverPerTxLimitReverts() public {
        vm.prank(aiSession);
        vm.expectRevert(
            abi.encodeWithSelector(
                TreasuryPolicyModule.PerTxLimitExceeded.selector,
                PER_TX_LIMIT + 1,
                PER_TX_LIMIT
            )
        );
        module.aiTransfer(address(usdc), vendor, PER_TX_LIMIT + 1, keccak256("INV-3"));
    }

    function testExpiredSessionReverts() public {
        vm.warp(sessionExpiry + 1);
        vm.prank(aiSession);
        vm.expectRevert(
            abi.encodeWithSelector(
                TreasuryPolicyModule.SessionExpired.selector,
                sessionExpiry + 1,
                sessionExpiry
            )
        );
        module.aiTransfer(address(usdc), vendor, 1000 * 1e6, keccak256("INV-4"));
    }

    function testStrangerCannotCallAiTransfer() public {
        vm.prank(strangerAddr);
        vm.expectRevert(TreasuryPolicyModule.NotAiSession.selector);
        module.aiTransfer(address(usdc), vendor, 1000 * 1e6, keccak256("INV-5"));
    }

    function testDailyLimitExceededReverts() public {
        bytes32 invA = keccak256("INV-A");
        bytes32 invB = keccak256("INV-B");
        bytes32 invC = keccak256("INV-C");

        vm.startPrank(root);
        module.approveInvoice(invA);
        module.approveInvoice(invB);
        vm.stopPrank();

        vm.startPrank(aiSession);
        module.aiTransfer(address(usdc), vendor, 5000 * 1e6, invA);
        module.aiTransfer(address(usdc), vendor, 5000 * 1e6, invB);
        // 今天已經用滿 10000 USDC 額度，再轉 1 USDC 就超過
        vm.expectRevert(
            abi.encodeWithSelector(
                TreasuryPolicyModule.DailyLimitExceeded.selector,
                10000 * 1e6 + 1 * 1e6,
                DAILY_LIMIT
            )
        );
        module.aiTransfer(address(usdc), vendor, 1 * 1e6, invC);
        vm.stopPrank();
    }

    function testDailyLimitResetsNextDay() public {
        bytes32 invD1 = keccak256("INV-D1");
        bytes32 invD2 = keccak256("INV-D2");
        bytes32 invE1 = keccak256("INV-E1");
        bytes32 invE2 = keccak256("INV-E2");

        vm.startPrank(root);
        module.approveInvoice(invD1);
        module.approveInvoice(invD2);
        module.approveInvoice(invE1);
        module.approveInvoice(invE2);
        vm.stopPrank();

        vm.startPrank(aiSession);
        module.aiTransfer(address(usdc), vendor, 5000 * 1e6, invD1);
        module.aiTransfer(address(usdc), vendor, 5000 * 1e6, invD2);
        vm.stopPrank();

        // 跳到隔天，每日額度應該要重新歸零
        vm.warp(block.timestamp + 1 days);

        vm.startPrank(aiSession);
        bool ok1 = module.aiTransfer(address(usdc), vendor, 5000 * 1e6, invE1);
        bool ok2 = module.aiTransfer(address(usdc), vendor, 5000 * 1e6, invE2);
        vm.stopPrank();

        assertTrue(ok1);
        assertTrue(ok2);
    }

    function testDuplicateInvoiceReverts() public {
        bytes32 inv = keccak256("INV-DUP");
        vm.startPrank(aiSession);
        module.aiTransfer(address(usdc), vendor, 500 * 1e6, inv);
        vm.expectRevert(
            abi.encodeWithSelector(TreasuryPolicyModule.DuplicatePayment.selector, inv)
        );
        module.aiTransfer(address(usdc), vendor, 500 * 1e6, inv);
        vm.stopPrank();
    }

    function testApprovalRequiredForLargeAmount() public {
        // 3000 USDC 超過 $2000 門檻，但還沒被 root 核准
        bytes32 inv = keccak256("INV-BIG");
        vm.prank(aiSession);
        vm.expectRevert(
            abi.encodeWithSelector(TreasuryPolicyModule.ApprovalRequired.selector, inv)
        );
        module.aiTransfer(address(usdc), vendor, 3000 * 1e6, inv);
    }

    function testApprovedLargeAmountSucceeds() public {
        bytes32 inv = keccak256("INV-BIG2");
        vm.prank(root);
        module.approveInvoice(inv);

        vm.prank(aiSession);
        bool ok = module.aiTransfer(address(usdc), vendor, 3000 * 1e6, inv);
        assertTrue(ok);
    }

    function testAiCannotApproveOwnInvoice() public {
        vm.prank(aiSession);
        vm.expectRevert(TreasuryPolicyModule.NotRoot.selector);
        module.approveInvoice(keccak256("INV-BIG3"));
    }
}
