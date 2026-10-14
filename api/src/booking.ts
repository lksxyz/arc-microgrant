import type { Availability as AvailabilitySchema } from './store'

export const TZ_OFFSET_SEC = 7 * 3600
export const MIN_LEAD_SEC = 3600
export const SLOT_HORIZON_DAYS = 14

export const BOOKING_CREATED_TOPIC = '0x26020dfb45e6e8b1e62cb471150b5bba51d7b863f8be741d40c2100f40cd3745'

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

export type TakenRange = { start: number; end: number }

export const computeSlots = (
  availability: typeof AvailabilitySchema.Type,
  durationMinutes: number,
  now: number,
  taken: ReadonlyArray<TakenRange>,
): number[] => {
  const startMin = toMinutes(availability.start)
  const endMin = toMinutes(availability.end)
  const durSec = durationMinutes * 60
  const todayIdx = Math.floor((now + TZ_OFFSET_SEC) / 86400)
  const out: number[] = []

  for (let d = 0; d < SLOT_HORIZON_DAYS; d++) {
    const dayIdx = todayIdx + d
    const weekday = (dayIdx + 4) % 7
    if (!availability.days.includes(weekday)) continue
    for (let m = startMin; m + durationMinutes <= endMin; m += durationMinutes) {
      const t = dayIdx * 86400 + m * 60 - TZ_OFFSET_SEC
      if (t < now + MIN_LEAD_SEC) continue
      const overlaps = taken.some((r) => t < r.end && t + durSec > r.start)
      if (!overlaps) out.push(t)
    }
  }
  return out
}

export type VerifyError = 'tx_pending' | 'tx_failed' | 'tx_mismatch' | 'rpc_error'

type Receipt = {
  status: string
  logs: { address: string; topics: string[]; data: string }[]
}

const rpcCall = async (rpcUrl: string, method: string, params: unknown[]) => {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  if (!res.ok) throw new Error(`rpc ${res.status}`)
  const body = (await res.json()) as { result?: unknown; error?: unknown }
  if (body.error) throw new Error('rpc error')
  return body.result ?? null
}

const addressFromTopic = (topic: string) => `0x${topic.slice(-40)}`.toLowerCase()

export const verifyDepositTx = async (
  rpcUrl: string,
  escrow: string,
  txHash: string,
  expect: { customer: string; merchant: string; scheduledAt: number; deposit: bigint },
): Promise<{ ok: true; bookingId: bigint } | { ok: false; error: VerifyError }> => {
  let receipt: Receipt | null
  try {
    receipt = (await rpcCall(rpcUrl, 'eth_getTransactionReceipt', [txHash])) as Receipt | null
  } catch {
    return { ok: false, error: 'rpc_error' }
  }
  if (!receipt) return { ok: false, error: 'tx_pending' }
  if (receipt.status !== '0x1') return { ok: false, error: 'tx_failed' }

  const log = receipt.logs.find(
    (l) =>
      l.address.toLowerCase() === escrow.toLowerCase() && l.topics[0] === BOOKING_CREATED_TOPIC,
  )
  if (!log || log.topics.length < 4) return { ok: false, error: 'tx_mismatch' }

  const customer = addressFromTopic(log.topics[2]!)
  const merchant = addressFromTopic(log.topics[3]!)
  const deposit = BigInt(`0x${log.data.slice(2, 66)}`)
  const scheduledAt = BigInt(`0x${log.data.slice(66, 130)}`)

  if (
    customer !== expect.customer.toLowerCase() ||
    merchant !== expect.merchant.toLowerCase() ||
    deposit !== expect.deposit ||
    scheduledAt !== BigInt(expect.scheduledAt)
  ) {
    return { ok: false, error: 'tx_mismatch' }
  }
  return { ok: true, bookingId: BigInt(log.topics[1]!) }
}

export const isHeld = (r: { status: string; expiresAt: string }, now: number) => {
  if (r.status === 'confirmed' || r.status === 'no_show_claimed' || r.status === 'disputed') return true
  if (r.status === 'pending') return Date.parse(r.expiresAt) / 1000 > now
  return false
}

export const NO_SHOW_CLAIMED_TOPIC = '0x899238f4c9640373cba29a6307395851847ff4e7c7db77ce6d2430d8d0f89b7c'
export const MERCHANT_CANCELLED_TOPIC = '0x26ffe6a1315b2129768beaea6f8c1bc358db1d784ef037030174c3f9c5cdcb49'

export const CUSTOMER_CANCELLED_TOPIC = '0x14d732aede77c2f46bc5576ffc5b11efd577b88bce39d976d8d3b8660644ea96'
export const NO_SHOW_OBJECTED_TOPIC = '0x81c122017e8ec04cd74b904c550ce1dcb646b21201a699a7252a25055d8a8ff1'
export const SETTLED_TOPIC = '0x65a2f5d7362c8f892f9089ce8e4a4459c957844b048a3b8040812c6c9d1d73ad'
export const RESCHEDULED_TOPIC = '0x1b2a933b9a89e1a6d09143d36c0634ca1b0e3272d1b9f56050af509a331ebb0f'

export const verifyEventTx = async (
  rpcUrl: string,
  escrow: string,
  txHash: string,
  topic0: string,
  bookingId: string,
  expectedFrom: string,
): Promise<{ ok: true; data: string } | { ok: false; error: VerifyError }> => {
  let receipt: (Receipt & { from: string }) | null
  try {
    receipt = (await rpcCall(rpcUrl, 'eth_getTransactionReceipt', [txHash])) as (Receipt & { from: string }) | null
  } catch {
    return { ok: false, error: 'rpc_error' }
  }
  if (!receipt) return { ok: false, error: 'tx_pending' }
  if (receipt.status !== '0x1') return { ok: false, error: 'tx_failed' }
  if (receipt.from.toLowerCase() !== expectedFrom.toLowerCase()) return { ok: false, error: 'tx_mismatch' }
  const wanted = BigInt(bookingId)
  const hit = receipt.logs.find(
    (l) =>
      l.address.toLowerCase() === escrow.toLowerCase() &&
      l.topics[0] === topic0 &&
      l.topics[1] !== undefined &&
      BigInt(l.topics[1]) === wanted,
  )
  return hit ? { ok: true, data: hit.data } : { ok: false, error: 'tx_mismatch' }
}

export const CHECKED_IN_TOPIC = '0x10114a3921e255a9ca7fe6729a90430550edc377c3a1f0a2b2456d778f852184'
export const REFUND_PARKED_TOPIC = '0x5ca58a8ba5a0552cde8046078ce4cf8587eb18960be6b17516f14eaf80115b1c'

const BOOKING_SELECTOR = '0x358dc19c'

export type ChainStatus = 1 | 2 | 3 | 4 | 5 | 6 | 7

export const readChainBooking = async (rpcUrl: string, escrow: string, id: string) => {
  const data = BOOKING_SELECTOR + BigInt(id).toString(16).padStart(64, '0')
  const res = await rpcCall(rpcUrl, 'eth_call', [{ to: escrow, data }, 'latest'])
  if (typeof res !== 'string' || res.length < 2 + 64 * 8) throw new Error('bad booking response')
  const word = (i: number) => res.slice(2 + i * 64, 2 + (i + 1) * 64)
  return {
    scheduledAt: Number(BigInt(`0x${word(3)}`)),
    status: Number(BigInt(`0x${word(4)}`)) as ChainStatus,
    reschedules: Number(BigInt(`0x${word(5)}`)),
  }
}
