import { Data, Effect, Schema } from 'effect'
import { Bindings } from './env'

export class StoreError extends Data.TaggedError('StoreError')<{ readonly cause: unknown }> {}
export class NotFound extends Data.TaggedError('NotFound')<{ readonly what: string }> {}

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/

export const Business = Schema.Struct({
  name: Schema.String,
  tagline: Schema.String,
  description: Schema.String,
  slug: Schema.String,
  payoutAddress: Schema.optional(Schema.String),
})
export type Business = typeof Business.Type

export const Availability = Schema.Struct({
  days: Schema.Array(Schema.Int),
  start: Schema.String,
  end: Schema.String,
})

export const ServiceInput = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  durationMinutes: Schema.Int,
  priceUsdc: Schema.String,
  depositUsdc: Schema.String,
  availability: Availability,
  active: Schema.Boolean,
  claimDelayHours: Schema.optional(Schema.Int),
})
export type ServiceInput = typeof ServiceInput.Type

export const Service = Schema.Struct({ id: Schema.String, ...ServiceInput.fields })
export type Service = typeof Service.Type

const kv = <A>(f: (kv: KVNamespace) => Promise<A>) =>
  Effect.gen(function* () {
    const { DATA } = yield* Bindings
    return yield* Effect.tryPromise({ try: () => f(DATA), catch: (cause) => new StoreError({ cause }) })
  })

const readJson = <A>(key: string) =>
  kv((d) => d.get(key, 'json')).pipe(Effect.map((v) => (v ?? null) as A | null))

const writeJson = (key: string, value: unknown) =>
  kv((d) => d.put(key, JSON.stringify(value)))

export const getBusiness = (uid: string) => readJson<Business & { updatedAt: string }>(`biz:${uid}`)

export const getSlugOwner = (slug: string) =>
  kv((d) => d.get(`slug:${slug}`, 'text')).pipe(Effect.map((v) => v ?? null))

export const putBusiness = (uid: string, b: Business) =>
  Effect.gen(function* () {
    const previous = yield* getBusiness(uid)
    if (previous?.slug && previous.slug !== b.slug) {
      yield* kv((d) => d.delete(`slug:${previous.slug}`))
    }
    yield* kv((d) => d.put(`slug:${b.slug}`, uid))
    yield* writeJson(`biz:${uid}`, { ...b, updatedAt: new Date().toISOString() })
  })

export const listServices = (uid: string) =>
  readJson<Service[]>(`svc:${uid}`).pipe(Effect.map((v) => v ?? []))

export const saveServices = (uid: string, services: Service[]) => writeJson(`svc:${uid}`, services)

export const RESERVATION_TTL_SEC = 15 * 60

export type BookingRecord = {
  ref: string
  status:
    | 'pending'
    | 'confirmed'
    | 'no_show_claimed'
    | 'merchant_cancelled'
    | 'disputed'
    | 'pay_merchant'
    | 'pay_customer'
    | 'paid'
  serviceId: string
  serviceName: string
  scheduledAt: number
  durationMinutes: number
  deposit: string
  customerName: string
  expiresAt: string
  createdAt: string
  customerAddress?: string
  txHash?: string
  onchainId?: string
  checkedInAt?: string
  actionTx?: string
  markedAt?: string
  reschedules?: number
  cancelledRefund?: boolean
  claimDelay?: number
  payee?: 'merchant' | 'customer'
}

export type CustomerEntry = { uid: string; ref: string }

export const listCustomerEntries = (address: string) =>
  readJson<CustomerEntry[]>(`cust:${address}`).pipe(Effect.map((v) => v ?? []))

export const addCustomerEntry = (address: string, entry: CustomerEntry) =>
  Effect.gen(function* () {
    const list = yield* listCustomerEntries(address)
    if (list.some((e) => e.ref === entry.ref)) return
    yield* writeJson(`cust:${address}`, [...list, entry])
  })

export const getRefOwner = (ref: string) =>
  kv((d) => d.get(`ref:${ref}`, 'text')).pipe(Effect.map((v) => v ?? null))

export const putRefOwner = (ref: string, uid: string) => kv((d) => d.put(`ref:${ref}`, uid))

export const listBookings = (uid: string) =>
  readJson<BookingRecord[]>(`bkg:${uid}`).pipe(Effect.map((v) => v ?? []))

export const saveBookings = (uid: string, bookings: BookingRecord[]) => writeJson(`bkg:${uid}`, bookings)
