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
    address vendor2 = address(0xCAFE);
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
        vm.startPrank(root);
        module.setAllowedRecipient(vendor, true);
        module.setAllowedRecipient(vendor2, true);
        vm.stopPrank();
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
        module.approveInvoice(address(usdc), vendor, 5000 * 1e6, invA);
        module.approveInvoice(address(usdc), vendor, 5000 * 1e6, invB);
        vm.stopPrank();
        vm.startPrank(aiSession);
        module.aiTransfer(address(usdc), vendor, 5000 * 1e6, invA);
        module.aiTransfer(address(usdc), vendor, 5000 * 1e6, invB);
        // 已經用滿 10000 USDC 額度，再轉 1 USDC 就超過
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
        module.approveInvoice(address(usdc), vendor, 5000 * 1e6, invD1);
        module.approveInvoice(address(usdc), vendor, 5000 * 1e6, invD2);
        module.approveInvoice(address(usdc), vendor, 5000 * 1e6, invE1);
        module.approveInvoice(address(usdc), vendor, 5000 * 1e6, invE2);
        vm.stopPrank();
        vm.startPrank(aiSession);
        module.aiTransfer(address(usdc), vendor, 5000 * 1e6, invD1);
        module.aiTransfer(address(usdc), vendor, 5000 * 1e6, invD2);
        vm.stopPrank();
        // 完整跳過 24 小時之後，額度才會恢復（rolling window，不是等午夜）
        vm.warp(block.timestamp + 1 days + 1);
        vm.startPrank(aiSession);
        bool ok1 = module.aiTransfer(address(usdc), vendor, 5000 * 1e6, invE1);
        bool ok2 = module.aiTransfer(address(usdc), vendor, 5000 * 1e6, invE2);
        vm.stopPrank();
        assertTrue(ok1);
        assertTrue(ok2);
    }
    /// @notice P0-2 修復驗證：舊制「日曆日」在午夜換日會讓額度提早重置，
    ///         這裡驗證真正的 rolling 24h 不會被「跨午夜」這招繞過。
    function testRollingWindowBlocksMidnightDoubleSpend() public {
        uint256 justBeforeMidnight = ((block.timestamp / 1 days) + 1) * 1 days - 30;
        vm.warp(justBeforeMidnight);
        bytes32 inv1 = keccak256("INV-ROLL-1");
        bytes32 inv2 = keccak256("INV-ROLL-2");
        vm.startPrank(root);
        module.approveInvoice(address(usdc), vendor, 5000 * 1e6, inv1);
        module.approveInvoice(address(usdc), vendor, 5000 * 1e6, inv2);
        vm.stopPrank();
        vm.startPrank(aiSession);
        module.aiTransfer(address(usdc), vendor, 5000 * 1e6, inv1);
        module.aiTransfer(address(usdc), vendor, 5000 * 1e6, inv2);
        vm.stopPrank();
        // 已花滿 10000 USDC 日限額。只過 60 秒，但跨過了「舊制」午夜換日線
        vm.warp(justBeforeMidnight + 60);
        bytes32 inv3 = keccak256("INV-ROLL-3");
        vm.prank(root);
        module.approveInvoice(address(usdc), vendor, 5000 * 1e6, inv3);
        vm.prank(aiSession);
        vm.expectRevert(
            abi.encodeWithSelector(
                TreasuryPolicyModule.DailyLimitExceeded.selector,
                15000 * 1e6,
                DAILY_LIMIT
            )
        );
        module.aiTransfer(address(usdc), vendor, 5000 * 1e6, inv3);
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
        module.approveInvoice(address(usdc), vendor, 3000 * 1e6, inv);
        vm.prank(aiSession);
        bool ok = module.aiTransfer(address(usdc), vendor, 3000 * 1e6, inv);
        assertTrue(ok);
    }
    function testAiCannotApproveOwnInvoice() public {
        vm.prank(aiSession);
        vm.expectRevert(TreasuryPolicyModule.NotRoot.selector);
        module.approveInvoice(address(usdc), vendor, 3000 * 1e6, keccak256("INV-BIG3"));
    }
    /// @notice P0-3 修復驗證：核准的是「付給 vendor」，AI 想改付給 vendor2
    ///         （即使 vendor2 也在白名單內）必須被擋下。
    function testApprovalBoundToRecipient() public {
        bytes32 inv = keccak256("INV-BOUND-1");
        vm.prank(root);
        module.approveInvoice(address(usdc), vendor, 3000 * 1e6, inv);
        vm.prank(aiSession);
        vm.expectRevert(
            abi.encodeWithSelector(TreasuryPolicyModule.ApprovalRequired.selector, inv)
        );
        module.aiTransfer(address(usdc), vendor2, 3000 * 1e6, inv);
    }
    /// @notice P0-3 修復驗證：核准的是 3000 USDC，AI 想改成 3500 USDC 必須被擋下。
    function testApprovalBoundToAmount() public {
        bytes32 inv = keccak256("INV-BOUND-2");
        vm.prank(root);
        module.approveInvoice(address(usdc), vendor, 3000 * 1e6, inv);
        vm.prank(aiSession);
        vm.expectRevert(
            abi.encodeWithSelector(TreasuryPolicyModule.ApprovalRequired.selector, inv)
        );
        module.aiTransfer(address(usdc), vendor, 3500 * 1e6, inv);
    }
    /// @notice P0-3 修復驗證：核准是一次性的，用過就消耗掉。
    function testApprovalConsumedAfterUse() public {
        bytes32 inv = keccak256("INV-BOUND-3");
        vm.prank(root);
        module.approveInvoice(address(usdc), vendor, 3000 * 1e6, inv);
        vm.prank(aiSession);
        module.aiTransfer(address(usdc), vendor, 3000 * 1e6, inv);
        bytes32 approvalHash = keccak256(abi.encode(address(usdc), vendor, uint256(3000 * 1e6), inv));
        assertFalse(module.approvedInvoice(approvalHash));
    }

    /// @dev Review #2：桶子式累計的成本有上界，不隨歷史筆數成長。
    ///      舊的 append-only 陣列版本在這裡會線性變貴並讓斷言失敗。
    function testSpamTransfersDoNotInflateGas() public {
        vm.startPrank(aiSession);
        uint256 g0 = gasleft();
        module.aiTransfer(address(usdc), vendor, 1 * 1e6, keccak256("SPAM-FIRST"));
        uint256 gasFirst = g0 - gasleft();

        for (uint256 i = 0; i < 40; i++) {
            module.aiTransfer(address(usdc), vendor, 1 * 1e6, keccak256(abi.encode("SPAM", i)));
        }

        uint256 g1 = gasleft();
        module.aiTransfer(address(usdc), vendor, 1 * 1e6, keccak256("SPAM-LAST"));
        uint256 gasLast = g1 - gasleft();
        vm.stopPrank();

        assertLt(gasLast, gasFirst + 5_000);
    }

    /// @dev Review #2：額度用滿後被擋；超過視窗長度後舊支出滑出視窗，可再付款。
    function testBucketWindowSlidesAfterWindowPasses() public {
        vm.startPrank(aiSession);
        for (uint256 i = 0; i < 5; i++) {
            module.aiTransfer(address(usdc), vendor, 2000 * 1e6, keccak256(abi.encode("FILL", i)));
        }

        vm.expectRevert(
            abi.encodeWithSelector(
                TreasuryPolicyModule.DailyLimitExceeded.selector,
                DAILY_LIMIT + 1 * 1e6,
                DAILY_LIMIT
            )
        );
        module.aiTransfer(address(usdc), vendor, 1 * 1e6, keccak256("OVER"));

        vm.warp(block.timestamp + 25 hours);
        bool ok = module.aiTransfer(address(usdc), vendor, 1 * 1e6, keccak256("AFTER-WINDOW"));
        assertTrue(ok);
        vm.stopPrank();
    }
}
