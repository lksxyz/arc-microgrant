// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {BookingEscrow} from "../src/BookingEscrow.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

/// @notice Local: deploys MockUSDC + escrow. Mainnet: set USDC_ADDRESS, skips the mock.
contract Deploy is Script {
    function run() external returns (BookingEscrow escrow, address token) {
        address arbiter = vm.envAddress("ARBITER");
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address usdcAddr = vm.envOr("USDC_ADDRESS", address(0));

        vm.startBroadcast(pk);
        if (usdcAddr == address(0)) {
            MockUSDC mock = new MockUSDC();
            token = address(mock);
        } else {
            token = usdcAddr;
        }
        escrow = new BookingEscrow(IERC20(token), arbiter);
        vm.stopBroadcast();
    }
}
