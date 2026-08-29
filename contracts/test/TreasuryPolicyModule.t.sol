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

    uint256 constant PER_TX_LIMIT = 5000 * 1e6; // 5000 USDC, 6 decimals
    uint256 sessionExpiry;

    function setUp() public {
        sessionExpiry = block.timestamp + 7 days;
        usdc = new MockUSDC();

        module = new TreasuryPolicyModule(
            root,
            aiSession,
            address(usdc),
            PER_TX_LIMIT,
            sessionExpiry
        );

        // fund the module like a vault, so aiTransfer has something to send
        usdc.mint(address(module), 1_000_000 * 1e6);

        // root whitelists the vendor
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
}
