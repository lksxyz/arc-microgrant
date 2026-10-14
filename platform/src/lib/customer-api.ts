import { createWalletClient, custom } from 'viem'
import type { ConnectedWallet } from '@privy-io/react-auth'
import { API_URL } from './api'
import { appChain } from './chain'

const CACHE_KEY = 'intensio:customer-auth'
const REUSE_SEC = 540

type Cached = { address: string; sig: string; ts: number }

export async function customerHeaders(wallet: ConnectedWallet): Promise<Record<string, string>> {
  const address = wallet.address.toLowerCase()
  const now = Math.floor(Date.now() / 1000)
  const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) ?? 'null') as Cached | null
  if (cached && cached.address === address && now - cached.ts < REUSE_SEC) {
    return { 'x-address': cached.address, 'x-signature': cached.sig, 'x-timestamp': String(cached.ts) }
  }
  const provider = await wallet.getEthereumProvider()
  const walletClient = createWalletClient({ account: wallet.address as `0x${string}`, chain: appChain, transport: custom(provider) })
  const sig = await walletClient.signMessage({ message: `Intensio my-bookings ${now}` })
  sessionStorage.setItem(CACHE_KEY, JSON.stringify({ address, sig, ts: now } satisfies Cached))
  return { 'x-address': address, 'x-signature': sig, 'x-timestamp': String(now) }
}

export async function customerFetch<T>(
  wallet: ConnectedWallet,
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
  const headers = await customerHeaders(wallet)
  const res = await fetch(`${API_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...headers },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  if (!res.ok) throw new Error((await res.text()) || res.statusText)
  return (await res.json()) as T
}
