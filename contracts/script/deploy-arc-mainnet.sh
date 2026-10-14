#!/usr/bin/env bash
set -euo pipefail

: "${PRIVATE_KEY:?set PRIVATE_KEY (deployer wallet with USDC on Arc for gas)}"
: "${ARBITER:?set ARBITER (alamat arbiter escrow)}"

RPC_URL="${ARC_RPC:-https://rpc.mainnet.arc.io}"
USDC_ADDRESS="${USDC_ADDRESS:-0x3600000000000000000000000000000000000000}"
EXPECTED_CHAIN_ID=5042
GAS_PRICE_WEI="${GAS_PRICE_WEI:-20000000000}"
FORGE="${FORGE:-arc-forge}"
CAST="${CAST:-arc-cast}"

if [[ "$ARBITER" == "0x0000000000000000000000000000000000000000" ]]; then
  echo "ARBITER must not be address(0)" >&2
  exit 1
fi

CHAIN_ID="$("$CAST" chain-id --rpc-url "$RPC_URL")"
if [[ "$CHAIN_ID" != "$EXPECTED_CHAIN_ID" ]]; then
  echo "Chain ID $CHAIN_ID, expected $EXPECTED_CHAIN_ID (Arc mainnet). Aborting." >&2
  exit 1
fi

DEPLOYER="$("$CAST" wallet address --private-key "$PRIVATE_KEY")"
BALANCE_WEI="$("$CAST" balance "$DEPLOYER" --rpc-url "$RPC_URL")"
echo "Deployer : $DEPLOYER"
echo "Balance  : $BALANCE_WEI (native USDC, 18 decimals)"
echo "USDC     : $USDC_ADDRESS"
echo "Arbiter  : $ARBITER"

cd "$(dirname "$0")/.."
export USDC_ADDRESS ARBITER PRIVATE_KEY

"$FORGE" script script/Deploy.s.sol \
  --rpc-url "$RPC_URL" \
  --broadcast \
  --with-gas-price "$GAS_PRICE_WEI" \
  -vvvv

echo
echo "Done. Find the BookingEscrow address in the log above or at https://explorer.arc.io"
echo "Then set ESCROW_ADDRESS in api/wrangler.jsonc and VITE_ESCROW_ADDRESS in platform/.env.production."
