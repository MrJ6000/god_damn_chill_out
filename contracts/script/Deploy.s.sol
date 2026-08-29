// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../src/TreasuryPolicyModule.sol";

contract Deploy is Script {
    uint256 constant SESSION_EXPIRY = 1788825540; // 2026-09-07T23:59:00Z
    uint256 constant PER_TX_LIMIT = 5000 * 1e6;    // 5000 USDC
    uint256 constant DAILY_LIMIT = 10000 * 1e6;    // 10000 USDC

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address root = vm.addr(vm.envUint("CFO_ROOT_PRIVATE_KEY"));
        address aiSession = vm.addr(vm.envUint("AI_SESSION_PRIVATE_KEY"));
        address usdc = vm.envAddress("USDC_ADDRESS");

        vm.startBroadcast(deployerKey);

        TreasuryPolicyModule module = new TreasuryPolicyModule(
            root,
            aiSession,
            usdc,
            PER_TX_LIMIT,
            DAILY_LIMIT,
            SESSION_EXPIRY
        );

        console.log("TreasuryPolicyModule deployed at:", address(module));
        console.log("root (CFO):", root);
        console.log("aiSession:", aiSession);

        vm.stopBroadcast();
    }
}
