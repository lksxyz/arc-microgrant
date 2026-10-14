# Arc Microgrant

Escrow-based booking app on Arc.

## Struktur

- `contracts/` — `BookingEscrow.sol` (Foundry)
- `api/` — Cloudflare Worker (Effect + viem), KV `DATA`
- `platform/` — frontend React/Vite, di-deploy sebagai Cloudflare Worker static assets

## Dev lokal

```bash
pnpm install
anvil                              # terminal 1
pnpm --filter api dev              # API di :8787
pnpm --filter platform dev         # UI di :5173
```

Konfigurasi dev ada di `platform/.env.development.local` dan `api/wrangler.jsonc` (blok top-level).

## Deploy Cloudflare (production)

1. Login: `pnpm exec wrangler login`
2. Buat KV namespace: `cd api && pnpm exec wrangler kv namespace create DATA`, lalu isi `id` di `env.production.kv_namespaces` pada `api/wrangler.jsonc`.
3. Isi `RPC_URL` dan `ESCROW_ADDRESS` (alamat hasil deploy contract di Arc mainnet) di `env.production.vars`.
4. Deploy API: `pnpm --filter api deploy`. Catat URL-nya.
5. Isi `platform/.env.production`: `VITE_API_URL`, `VITE_CHAIN_ID`, `VITE_RPC_URL`, `VITE_ESCROW_ADDRESS`, `VITE_USDC_ADDRESS`, `VITE_EXPLORER_URL`.
6. Set `ALLOWED_ORIGINS` di `api/wrangler.jsonc` (`env.production.vars`) ke URL platform, lalu deploy ulang API.
7. Deploy platform: `pnpm --filter platform deploy` (menjalankan build dulu via moon, atau `pnpm --filter platform build && pnpm --filter platform deploy`).

## Contracts

```bash
cd contracts
forge build
forge test
```

Deploy ke Arc: lihat `contracts/README.md`.
