# Arc Booking Escrow

Booking app dengan deposit USDC yang dikunci di escrow on-chain di **Arc mainnet**. Customer membayar deposit untuk mengunci slot, merchant menerima deposit setelah layanan berlangsung, dan sengketa diputuskan oleh arbiter dengan batas waktu 72 jam.

## Live di Arc mainnet

| Komponen | Link |
| :- | :- |
| App (frontend) | https://platform.lukis.workers.dev |
| API (Cloudflare Worker) | https://api.lukis.workers.dev |
| Contract `BookingEscrow` | [`0xB03359a5100B1403FaBA7FAcF68b15BCa791de20`](https://explorer.arc.io/address/0xB03359a5100B1403FaBA7FAcF68b15BCa791de20) |

- Chain ID: `5042`
- RPC: `https://rpc.mainnet.arc.io`
- Token pembayaran: USDC ERC-20 interface `0x3600000000000000000000000000000000000000` (6 desimal)
- Arbiter: `0xf52b1B2114B20f581a24dBC36dE6F0c20255dd33`
- Source contract terverifikasi di ArcScan dengan Standard JSON Input.

## Apa yang dipakai dari Arc

- **USDC sebagai deposit dan gas.** Semua deposit booking dalam USDC di Arc. Gas dibayar dengan USDC native.
- **Escrow on-chain.** `BookingEscrow.sol` menyimpan deposit per booking, lalu mengatur pembayaran ke merchant atau refund ke customer lewat state machine on-chain.
- **Finalitas cepat.** Check-in, pembatalan, dan klaim no-show langsung final di Arc, tanpa menunggu banyak konfirmasi.

## Struktur repo

- `contracts/`: `BookingEscrow.sol` (Foundry), test, script deploy.
- `api/`: Cloudflare Worker (Effect + viem), auth Privy, KV `DATA`.
- `platform/`: frontend React + Vite, di-deploy sebagai Cloudflare Worker static assets.

## Jalankan lokal

```bash
pnpm install
anvil                              # terminal 1, chain lokal
pnpm --filter api dev              # API di :8787
pnpm --filter platform dev         # UI di :5173
```

Config dev ada di `platform/.env.development.local` dan blok top-level `api/wrangler.jsonc`.

## Deploy

**Contract (Arc mainnet)**

```bash
cd contracts
PRIVATE_KEY=0x... ARBITER=0x... ./script/deploy-arc-mainnet.sh
```

Butuh Arc Foundry (`arc-forge`, `arc-cast`). Wallet deployer harus punya USDC di Arc untuk gas.

**Cloudflare**

1. `pnpm exec wrangler login`
2. Buat KV: `cd api && pnpm exec wrangler kv namespace create DATA`, isi `id` di `env.production`.
3. Deploy API: `pnpm --filter api deploy`
4. Isi `platform/.env.production`, lalu deploy frontend: `pnpm --filter platform build && pnpm --filter platform deploy`
5. Set `ALLOWED_ORIGINS` di `api/wrangler.jsonc` ke URL platform, lalu deploy ulang API.

## Contracts

```bash
cd contracts
forge build
forge test
```

Detail lebih lanjut di `contracts/README.md`.

## Builder

- GitHub: [@lksxyz](https://github.com/lksxyz)
- X: [@lukisanksatriya](https://x.com/lukisanksatriya)
