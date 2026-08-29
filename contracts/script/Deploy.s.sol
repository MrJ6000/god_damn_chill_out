// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../src/TreasuryPolicyModule.sol";

contract Deploy is Script {
    // 2026-09-07T23:59:00Z，對應 07_Shared_Spec.md 的 SESSION_EXPIRES_AT
    uint256 constant SESSION_EXPIRY = 1788825540;
    // 單筆上限 5000 USDC（07b_Demo_Numbers.md），USDC 是 6 位小數
    uint256 constant PER_TX_LIMIT = 5000 * 1e6;

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
            SESSION_EXPIRY
        );

        console.log("TreasuryPolicyModule deployed at:", address(module));
        console.log("root (CFO):", root);
        console.log("aiSession:", aiSession);

        vm.stopBroadcast();
    }
}
