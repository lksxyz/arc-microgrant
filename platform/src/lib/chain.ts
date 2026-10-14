import { defineChain, parseAbi } from 'viem'

const chainId = Number(import.meta.env.VITE_CHAIN_ID ?? 31337)
const rpcUrl = import.meta.env.VITE_RPC_URL ?? 'http://127.0.0.1:8545'

export const appChain = defineChain({
  id: chainId,
  name: chainId === 31337 ? 'Anvil' : 'Arc',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
})

export const EXPLORER_URL = (import.meta.env.VITE_EXPLORER_URL ?? '').replace(/\/$/, '')

export const txUrl = (hash: string) => (EXPLORER_URL ? `${EXPLORER_URL}/tx/${hash}` : null)

export const ESCROW_ADDRESS = import.meta.env.VITE_ESCROW_ADDRESS as `0x${string}`
export const USDC_ADDRESS = import.meta.env.VITE_USDC_ADDRESS as `0x${string}`

export const escrowAbi = parseAbi([
  'function createBooking(address merchant, uint96 deposit, uint40 scheduledAt, uint32 claimDelay) returns (uint256)',
  'function checkIn(uint256 id)',
  'function claimMerchant(uint256 id)',
  'function claimRefund(uint256 id)',
  'function markNoShow(uint256 id)',
  'function cancelByMerchant(uint256 id)',
  'function cancelByCustomer(uint256 id)',
  'function objectNoShow(uint256 id)',
  'function refundAfterMerchantCancel(uint256 id)',
  'function reschedule(uint256 id, uint40 newScheduledAt)',
])

export const erc20Abi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
])
