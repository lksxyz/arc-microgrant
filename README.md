# Arc Booking Escrow

A booking app where customers pay a USDC deposit into an on-chain escrow on **Arc mainnet**. The deposit locks the slot. The merchant receives it after the service takes place. Disputes are resolved by an arbiter within 72 hours.

## Live on Arc mainnet

| Component | Link |
| :- | :- |
| App (frontend) | https://platform.lukis.workers.dev |
| API (Cloudflare Worker) | https://api.lukis.workers.dev |
| `BookingEscrow` contract | [`0xB03359a5100B1403FaBA7FAcF68b15BCa791de20`](https://explorer.arc.io/address/0xB03359a5100B1403FaBA7FAcF68b15BCa791de20) |

- Chain ID: `5042`
- RPC: `https://rpc.drpc.mainnet.arc.io`
- Payment token: USDC ERC-20 interface `0x3600000000000000000000000000000000000000` (6 decimals)
- Arbiter: `0xf52b1B2114B20f581a24dBC36dE6F0c20255dd33`
- Contract source is verified on ArcScan (Standard JSON Input).

## How the app uses Arc

- **USDC for deposits and gas.** Booking deposits are in USDC on Arc. Gas is paid in native USDC.
- **On-chain escrow.** `BookingEscrow.sol` holds each booking's deposit and settles it to the merchant or refunds the customer through an on-chain state machine.
- **Fast finality.** Check-in, cancellations, and no-show claims are final on Arc without waiting for multiple confirmations.

## Repo structure

- `contracts/`: `BookingEscrow.sol` (Foundry), tests, and the deploy script.
- `api/`: Cloudflare Worker (Effect + viem), Privy auth, KV `DATA`.
- `platform/`: React + Vite frontend, deployed as Cloudflare Worker static assets.

## Run locally

```bash
pnpm install
anvil                              # terminal 1, local chain
pnpm --filter api dev              # API on :8787
pnpm --filter platform dev         # UI on :5173
```

Dev config lives in `platform/.env.development.local` and the top-level block of `api/wrangler.jsonc`.

## Deploy

**Contract (Arc mainnet)**

```bash
cd contracts
PRIVATE_KEY=0x... ARBITER=0x... ./script/deploy-arc-mainnet.sh
```

Requires Arc Foundry (`arc-forge`, `arc-cast`). The deployer wallet needs USDC on Arc for gas. See `contracts/README.md`.

**Cloudflare**

1. `pnpm exec wrangler login`
2. Create the KV namespace: `cd api && pnpm exec wrangler kv namespace create DATA`, then set the `id` in `env.production`.
3. Deploy the API: `pnpm --filter api deploy`
4. Fill in `platform/.env.production`, then deploy the frontend: `pnpm --filter platform build && pnpm --filter platform deploy`
5. Set `ALLOWED_ORIGINS` in `api/wrangler.jsonc` to the platform URL, then redeploy the API.

## Contracts

```bash
cd contracts
forge build
forge test
```

## Builder

- GitHub: [@lksxyz](https://github.com/lksxyz)
- X: [@lukisanksatriya](https://x.com/lukisanksatriya)

## Roadmap

### WhatsApp booking flow (research)

Customers will be able to book through WhatsApp, not only through the web link. This is currently being researched. Planned scope:

- Customers pick a service and time slot in a WhatsApp chat.
- The bot sends a payment link to the same deposit flow used on the web, so the USDC deposit still goes through the `BookingEscrow` contract on Arc.
- Booking status updates (confirmed, cancelled, reschedule) are sent back to the customer over WhatsApp.

Open questions being researched:
- WhatsApp Business API provider and onboarding requirements.
- Whether the bot can hold a wallet session or should hand off to the web app for signing.
- Message template approval rules for booking and reminder messages.

Nothing in this section is implemented yet.
