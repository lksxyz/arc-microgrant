# contracts

Escrow deposit booking (`src/BookingEscrow.sol`). Foundry.

```bash
forge build
forge test                 # 17 test, termasuk fuzz solvency
forge test --gas-report

# lokal (anvil)
anvil
PRIVATE_KEY=<key> ARBITER=<addr> forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast

# Arc: set USDC_ADDRESS agar MockUSDC tidak dideploy
USDC_ADDRESS=<usdc> PRIVATE_KEY=<key> ARBITER=<addr> forge script script/Deploy.s.sol --rpc-url $ARC_RPC --broadcast
```

`MockUSDC` hanya untuk lokal (mint bebas).
