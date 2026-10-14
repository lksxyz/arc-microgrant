# Contracts

`src/BookingEscrow.sol`: booking escrow for USDC deposits. Built with Foundry.

## Build and test

```bash
forge build
forge test                 # 17 tests, including fuzz solvency tests
forge test --gas-report
```

## Local (anvil)

```bash
anvil
PRIVATE_KEY=<key> ARBITER=<addr> forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
```

Locally, `Deploy.s.sol` also deploys `MockUSDC`. It is for local use only (free minting).

## Arc mainnet

Requires Arc Foundry (`arc-forge`, `arc-cast`). The deployer wallet needs USDC on Arc for gas.

```bash
PRIVATE_KEY=0x... ARBITER=0x... ./script/deploy-arc-mainnet.sh
```

The script:
- rejects `ARBITER` set to `address(0)`
- checks the RPC chain ID is `5042` before broadcasting
- prints the deployer address and balance
- uses USDC `0x3600000000000000000000000000000000000000` and a 20 Gwei gas price
- does not deploy `MockUSDC`

## Verification

`verify-BookingEscrow.standard-input.json` is the Standard JSON Input for ArcScan. Use "Solidity (Standard-JSON-Input)" and set the constructor arguments to the ABI-encoded `(token, arbiter)`.

Deployed contract: `0xB03359a5100B1403FaBA7FAcF68b15BCa791de20` (Arc mainnet).
