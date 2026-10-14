import { Context, Effect, Layer, Schema } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http'
import { Bindings, type Env } from './env'
import { currentUserId, verifyCustomerSignature } from './auth'
import {
  CHECKED_IN_TOPIC,
  REFUND_PARKED_TOPIC,
  readChainBooking,
  CUSTOMER_CANCELLED_TOPIC,
  NO_SHOW_OBJECTED_TOPIC,
  RESCHEDULED_TOPIC,
  SETTLED_TOPIC,
  computeSlots,
  isHeld,
  MERCHANT_CANCELLED_TOPIC,
  NO_SHOW_CLAIMED_TOPIC,
  verifyDepositTx,
  verifyEventTx,
} from './booking'
import {
  RESERVATION_TTL_SEC,
  SLUG_PATTERN,
  addCustomerEntry,
  getRefOwner,
  listCustomerEntries,
  putRefOwner,
  saveBookings,
  type BookingRecord,
  getBusiness,
  getSlugOwner,
  listBookings,
  listServices,
  NotFound,
  putBusiness,
  saveServices,
  Business,
  ServiceInput,
  type Service,
} from './store'

const authed = (
  f: (uid: string) => Effect.Effect<HttpServerResponse.HttpServerResponse, any, any>,
) =>
  Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest
    const uid = yield* currentUserId(req.headers.authorization)
    return yield* f(uid)
  }).pipe(
    Effect.catchTag('Unauthorized', () =>
      Effect.succeed(HttpServerResponse.jsonUnsafe({ error: 'unauthorized' }, { status: 401 })),
    ),
    Effect.catchTag('NotFound', () =>
      Effect.succeed(HttpServerResponse.jsonUnsafe({ error: 'not_found' }, { status: 404 })),
    ),
  )

const jsonError = (status: number, error: string) =>
  HttpServerResponse.jsonUnsafe({ error }, { status })

const toUsdcUnits = (amount: string) => {
  const [whole = '0', frac = ''] = amount.split('.')
  return BigInt(whole) * 1_000_000n + BigInt((frac + '000000').slice(0, 6))
}

const nowSec = () => Math.floor(Date.now() / 1000)

const takenRanges = (bookings: BookingRecord[], now: number) =>
  bookings
    .filter((b) => isHeld(b, now))
    .map((b) => ({ start: b.scheduledAt, end: b.scheduledAt + b.durationMinutes * 60 }))

const loadReservation = (ref: string) =>
  Effect.gen(function* () {
    const uid = yield* getRefOwner(ref)
    if (!uid) return null
    const bookings = yield* listBookings(uid)
    const record = bookings.find((b) => b.ref === ref)
    if (!record) return null
    const business = yield* getBusiness(uid)
    const services = yield* listServices(uid)
    const service = services.find((s) => s.id === record.serviceId)
    if (!service) return null
    return { uid, record, bookings, business, service }
  })

const publicServiceView = (s: Service) => ({
  id: s.id,
  name: s.name,
  description: s.description,
  durationMinutes: s.durationMinutes,
  priceUsdc: s.priceUsdc,
  depositUsdc: s.depositUsdc,
  availability: s.availability,
})

const ReservationInput = Schema.Struct({
  scheduledAt: Schema.Int,
  customerName: Schema.String,
})

const ActionInput = Schema.Struct({ txHash: Schema.String })

const ConfirmInput = Schema.Struct({
  txHash: Schema.String,
  customerAddress: Schema.String,
})

const publicService = (
  f: (ctx: { uid: string; service: Service; business: (Business & { updatedAt: string; payoutAddress?: string }) | null }) => Effect.Effect<HttpServerResponse.HttpServerResponse, any, any>,
) =>
  Effect.gen(function* () {
    const { slug, serviceId } = yield* HttpRouter.params
    const uid = yield* getSlugOwner(slug!)
    if (!uid) return jsonError(404, 'not_found')
    const services = yield* listServices(uid)
    const service = services.find((s) => s.id === serviceId && s.active)
    if (!service) return jsonError(404, 'not_found')
    const business = yield* getBusiness(uid)
    return yield* f({ uid, service, business })
  })

const CHAIN_TO_STATUS: Record<number, BookingRecord['status']> = {
  1: 'confirmed',
  2: 'no_show_claimed',
  3: 'disputed',
  4: 'merchant_cancelled',
  5: 'pay_merchant',
  6: 'pay_customer',
  7: 'paid',
}

const applyChain = (b: BookingRecord, chain: { status: number; scheduledAt: number; reschedules: number }): BookingRecord => {
  const target = CHAIN_TO_STATUS[chain.status]
  if (!target) return b
  if (chain.status === 1 && b.status !== 'confirmed' && b.status !== 'no_show_claimed' && b.status !== 'merchant_cancelled') return b
  const payee = target === 'paid' ? b.payee ?? (b.status === 'pay_customer' ? 'customer' : 'merchant') : b.payee
  const next: BookingRecord = {
    ...b,
    status: target,
    scheduledAt: chain.scheduledAt,
    reschedules: chain.reschedules,
    payee,
  }
  const same = next.status === b.status && next.scheduledAt === b.scheduledAt && next.reschedules === b.reschedules && next.payee === b.payee
  return same ? b : next
}

const syncBookings = (uid: string, bookings: BookingRecord[]) =>
  Effect.gen(function* () {
    const rpcUrl = yield* Bindings.pipe(Effect.map((b) => b.RPC_URL))
    const escrow = yield* Bindings.pipe(Effect.map((b) => b.ESCROW_ADDRESS))
    let changed = false
    const out: BookingRecord[] = []
    for (const b of bookings) {
      if (!b.onchainId || b.status === 'pending' || b.status === 'paid') {
        out.push(b)
        continue
      }
      const chain = yield* Effect.promise(() => readChainBooking(rpcUrl, escrow, b.onchainId!).catch(() => null))
      const next = chain ? applyChain(b, chain) : b
      if (next !== b) changed = true
      out.push(next)
    }
    if (changed) yield* saveBookings(uid, out)
    return out
  })

const merchantAction = (expected: BookingRecord['status'][], next: BookingRecord['status'], topic: string, patch: Partial<BookingRecord> = {}) =>
  authed((uid) =>
    Effect.gen(function* () {
      const { ref } = yield* HttpRouter.params
      const input = yield* HttpServerRequest.schemaBodyJson(ActionInput)
      const bookings = yield* syncBookings(uid, yield* listBookings(uid))
      const record = bookings.find((b) => b.ref === ref)
      if (!record) return jsonError(404, 'not_found')
      if ((!expected.includes(record.status) && record.status !== next) || !record.onchainId) return jsonError(409, 'invalid_status')
      if (bookings.some((b) => b.actionTx === input.txHash)) return jsonError(409, 'tx_already_recorded')
      const business = yield* getBusiness(uid)
      if (!business?.payoutAddress) return jsonError(409, 'payout_not_configured')
      const rpcUrl = yield* Bindings.pipe(Effect.map((b) => b.RPC_URL))
      const escrow = yield* Bindings.pipe(Effect.map((b) => b.ESCROW_ADDRESS))
      const verified = yield* Effect.promise(() =>
        verifyEventTx(rpcUrl, escrow, input.txHash, topic, record.onchainId!, business.payoutAddress!),
      )
      if (!verified.ok) return jsonError(422, verified.error)
      const updated: BookingRecord = { ...record, ...patch, status: next, actionTx: input.txHash }
      yield* saveBookings(uid, bookings.map((b) => (b.ref === ref ? updated : b)))
      return HttpServerResponse.jsonUnsafe({ booking: updated })
    }).pipe(Effect.catchTag('SchemaError', () => Effect.succeed(jsonError(400, 'invalid_body')))),
  )

const customerView = (r: BookingRecord, business: Business | null) => ({
  ref: r.ref,
  status: r.status,
  serviceName: r.serviceName,
  durationMinutes: r.durationMinutes,
  scheduledAt: r.scheduledAt,
  deposit: r.deposit,
  customerName: r.customerName,
  onchainId: r.onchainId ?? null,
  txHash: r.txHash ?? null,
  actionTx: r.actionTx ?? null,
  checkedInAt: r.checkedInAt ?? null,
  markedAt: r.markedAt ?? null,
  cancelledRefund: r.cancelledRefund ?? null,
  reschedules: r.reschedules ?? 0,
  claimDelay: r.claimDelay ?? 0,
  payee: r.payee ?? null,
  merchantName: business?.name ?? null,
})

const loadCustomerBooking = (address: string, ref: string) =>
  Effect.gen(function* () {
    const entries = yield* listCustomerEntries(address)
    const entry = entries.find((e) => e.ref === ref)
    if (!entry) return null
    const bookings = yield* syncBookings(entry.uid, yield* listBookings(entry.uid))
    const record = bookings.find((b) => b.ref === ref)
    if (!record) return null
    const business = yield* getBusiness(entry.uid)
    const services = yield* listServices(entry.uid)
    const service = services.find((x) => x.id === record.serviceId)
    if (!service) return null
    return { uid: entry.uid, record, bookings, business, service }
  })

const customerRoute = (f: (address: string) => Effect.Effect<HttpServerResponse.HttpServerResponse, any, any>) =>
  Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest
    const address = yield* verifyCustomerSignature({
      address: req.headers['x-address'],
      signature: req.headers['x-signature'],
      timestamp: req.headers['x-timestamp'],
    })
    return yield* f(address)
  }).pipe(Effect.catchTag('Unauthorized', () => Effect.succeed(jsonError(401, 'unauthorized'))))

const ActionBody = Schema.Struct({
  action: Schema.Literals(['cancel', 'object', 'refund', 'reschedule', 'claim']),
  txHash: Schema.String,
  newScheduledAt: Schema.optional(Schema.Int),
})

const routes = Layer.mergeAll(
  HttpRouter.add('GET', '/health', HttpServerResponse.json({ status: 'ok' })),

  HttpRouter.add('GET', '/me/business', authed((uid) =>
    getBusiness(uid).pipe(Effect.map((b) => HttpServerResponse.jsonUnsafe({ business: b }))),
  )),

  HttpRouter.add('PUT', '/me/business', authed((uid) =>
    Effect.gen(function* () {
      const input = yield* HttpServerRequest.schemaBodyJson(Business)
      if (!SLUG_PATTERN.test(input.slug)) {
        return HttpServerResponse.jsonUnsafe({ error: 'invalid_slug' }, { status: 400 })
      }
      const owner = yield* getSlugOwner(input.slug)
      if (owner && owner !== uid) {
        return HttpServerResponse.jsonUnsafe({ error: 'slug_taken' }, { status: 409 })
      }
      yield* putBusiness(uid, input)
      return HttpServerResponse.jsonUnsafe({ business: input })
    }).pipe(Effect.catchTag('SchemaError', () =>
      Effect.succeed(HttpServerResponse.jsonUnsafe({ error: 'invalid_body' }, { status: 400 })),
    )),
  )),

  HttpRouter.add('GET', '/me/services', authed((uid) =>
    listServices(uid).pipe(Effect.map((services) => HttpServerResponse.jsonUnsafe({ services }))),
  )),

  HttpRouter.add('POST', '/me/services', authed((uid) =>
    Effect.gen(function* () {
      const input = yield* HttpServerRequest.schemaBodyJson(ServiceInput)
      const service: Service = { id: crypto.randomUUID(), ...input }
      const services = yield* listServices(uid)
      yield* saveServices(uid, [...services, service])
      return HttpServerResponse.jsonUnsafe({ service }, { status: 201 })
    }).pipe(Effect.catchTag('SchemaError', () =>
      Effect.succeed(HttpServerResponse.jsonUnsafe({ error: 'invalid_body' }, { status: 400 })),
    )),
  )),

  HttpRouter.add('GET', '/me/services/:id', authed((uid) =>
    Effect.gen(function* () {
      const { id } = yield* HttpRouter.params
      const services = yield* listServices(uid)
      const service = services.find((s) => s.id === id)
      if (!service) return yield* Effect.fail(new NotFound({ what: 'service' }))
      return HttpServerResponse.jsonUnsafe({ service })
    }),
  )),

  HttpRouter.add('PUT', '/me/services/:id', authed((uid) =>
    Effect.gen(function* () {
      const { id } = yield* HttpRouter.params
      const input = yield* HttpServerRequest.schemaBodyJson(ServiceInput)
      const services = yield* listServices(uid)
      if (!services.some((s) => s.id === id)) return yield* Effect.fail(new NotFound({ what: 'service' }))
      const service: Service = { id: id!, ...input }
      yield* saveServices(uid, services.map((s) => (s.id === id ? service : s)))
      return HttpServerResponse.jsonUnsafe({ service })
    }).pipe(Effect.catchTag('SchemaError', () =>
      Effect.succeed(HttpServerResponse.jsonUnsafe({ error: 'invalid_body' }, { status: 400 })),
    )),
  )),

  HttpRouter.add('DELETE', '/me/services/:id', authed((uid) =>
    Effect.gen(function* () {
      const { id } = yield* HttpRouter.params
      const services = yield* listServices(uid)
      yield* saveServices(uid, services.filter((s) => s.id !== id))
      return HttpServerResponse.jsonUnsafe({ ok: true })
    }),
  )),

  HttpRouter.add('GET', '/public/b/:slug/services/:serviceId', publicService((ctx) =>
    Effect.succeed(HttpServerResponse.jsonUnsafe({
      business: ctx.business ? { name: ctx.business.name, tagline: ctx.business.tagline } : null,
      service: publicServiceView(ctx.service),
    })),
  )),

  HttpRouter.add('GET', '/public/b/:slug/services/:serviceId/slots', publicService((ctx) =>
    Effect.gen(function* () {
      const bookings = yield* listBookings(ctx.uid)
      const now = nowSec()
      const slots = computeSlots(ctx.service.availability, ctx.service.durationMinutes, now, takenRanges(bookings, now))
      return HttpServerResponse.jsonUnsafe({ slots })
    }),
  )),

  HttpRouter.add('POST', '/public/b/:slug/services/:serviceId/reservations', publicService((ctx) =>
    Effect.gen(function* () {
      const input = yield* HttpServerRequest.schemaBodyJson(ReservationInput)
      const name = input.customerName.trim()
      if (!name) return jsonError(400, 'invalid_body')
      if (!ctx.business?.payoutAddress) return jsonError(409, 'payout_not_configured')
      if (!/^\d+(\.\d{1,6})?$/.test(ctx.service.depositUsdc)) return jsonError(409, 'deposit_not_configured')

      const bookings = yield* listBookings(ctx.uid)
      const now = nowSec()
      const free = computeSlots(ctx.service.availability, ctx.service.durationMinutes, now, takenRanges(bookings, now))
      if (!free.includes(input.scheduledAt)) return jsonError(409, 'slot_unavailable')

      const ref = crypto.randomUUID()
      const record: BookingRecord = {
        ref,
        status: 'pending',
        serviceId: ctx.service.id,
        serviceName: ctx.service.name,
        scheduledAt: input.scheduledAt,
        durationMinutes: ctx.service.durationMinutes,
        deposit: toUsdcUnits(ctx.service.depositUsdc).toString(),
        customerName: name,
        claimDelay: (ctx.service.claimDelayHours ?? 24) * 3600,
        expiresAt: new Date((now + RESERVATION_TTL_SEC) * 1000).toISOString(),
        createdAt: new Date(now * 1000).toISOString(),
      }
      yield* saveBookings(ctx.uid, [...bookings, record])
      yield* putRefOwner(ref, ctx.uid)
      return HttpServerResponse.jsonUnsafe({ ref, expiresAt: record.expiresAt }, { status: 201 })
    }).pipe(Effect.catchTag('SchemaError', () => Effect.succeed(jsonError(400, 'invalid_body')))),
  )),

  HttpRouter.add('GET', '/public/deposits/:ref', Effect.gen(function* () {
    const { ref } = yield* HttpRouter.params
    const found = yield* loadReservation(ref!)
    if (!found) return jsonError(404, 'not_found')
    const { record, business, service } = found
    const now = nowSec()
    const status = record.status !== 'pending' ? 'confirmed' : Date.parse(record.expiresAt) / 1000 > now ? 'pending' : 'expired'
    return HttpServerResponse.jsonUnsafe({
      status,
      ref: record.ref,
      expiresAt: record.expiresAt,
      scheduledAt: record.scheduledAt,
      customerName: record.customerName,
      onchainId: record.onchainId ?? null,
      txHash: record.txHash ?? null,
      claimDelay: record.claimDelay ?? 86400,
      business: business ? { name: business.name } : null,
      payoutAddress: business?.payoutAddress ?? null,
      service: publicServiceView(service),
    })
  })),

  HttpRouter.add('POST', '/public/deposits/:ref/confirm', Effect.gen(function* () {
    const { ref } = yield* HttpRouter.params
    const input = yield* HttpServerRequest.schemaBodyJson(ConfirmInput)
    const found = yield* loadReservation(ref!)
    if (!found) return jsonError(404, 'not_found')
    const { uid, record, business, bookings } = found
    if (record.status !== 'pending') return jsonError(409, 'already_confirmed')
    if (bookings.some((b) => b.txHash === input.txHash)) return jsonError(409, 'tx_already_recorded')
    if (!business?.payoutAddress) return jsonError(409, 'payout_not_configured')

    const now = nowSec()
    const others = bookings.filter((b) => b.ref !== record.ref)
    const clash = takenRanges(others, now).some(
      (r) => record.scheduledAt < r.end && record.scheduledAt + record.durationMinutes * 60 > r.start,
    )
    if (clash) return jsonError(409, 'slot_unavailable')

    const rpcUrl = yield* Bindings.pipe(Effect.map((b) => b.RPC_URL))
    const escrow = yield* Bindings.pipe(Effect.map((b) => b.ESCROW_ADDRESS))
    const verified = yield* Effect.promise(() =>
      verifyDepositTx(rpcUrl, escrow, input.txHash, {
        customer: input.customerAddress,
        merchant: business.payoutAddress!,
        scheduledAt: record.scheduledAt,
        deposit: BigInt(record.deposit),
      }),
    )
    if (!verified.ok) return jsonError(422, verified.error)

    const updated: BookingRecord = {
      ...record,
      status: 'confirmed',
      txHash: input.txHash,
      customerAddress: input.customerAddress.toLowerCase(),
      onchainId: verified.bookingId.toString(),
    }
    yield* saveBookings(uid, bookings.map((b) => (b.ref === record.ref ? updated : b)))
    yield* addCustomerEntry(updated.customerAddress!, { uid, ref: record.ref })
    return HttpServerResponse.jsonUnsafe({ booking: updated })
  }).pipe(Effect.catchTag('SchemaError', () => Effect.succeed(jsonError(400, 'invalid_body'))))),

  HttpRouter.add('POST', '/me/bookings/:ref/checkin', merchantAction(['confirmed'], 'pay_customer', CHECKED_IN_TOPIC, { checkedInAt: new Date().toISOString() })),
  HttpRouter.add('POST', '/me/bookings/:ref/no-show', merchantAction(['confirmed'], 'no_show_claimed', NO_SHOW_CLAIMED_TOPIC, { markedAt: new Date().toISOString() })),
  HttpRouter.add('POST', '/me/bookings/:ref/cancel', merchantAction(['confirmed'], 'merchant_cancelled', MERCHANT_CANCELLED_TOPIC, { markedAt: new Date().toISOString() })),
  HttpRouter.add('POST', '/me/bookings/:ref/claim', merchantAction(['pay_merchant'], 'paid', SETTLED_TOPIC, { payee: 'merchant' })),

  HttpRouter.add('GET', '/public/my-bookings', customerRoute((address) =>
    Effect.gen(function* () {
      const entries = yield* listCustomerEntries(address)
      const out: unknown[] = []
      for (const e of entries) {
        const bookings = yield* syncBookings(e.uid, yield* listBookings(e.uid))
        const record = bookings.find((b) => b.ref === e.ref)
        if (!record) continue
        const business = yield* getBusiness(e.uid)
        out.push(customerView(record, business))
      }
      return HttpServerResponse.jsonUnsafe({ bookings: out })
    }),
  )),

  HttpRouter.add('GET', '/public/my-bookings/:ref', customerRoute((address) =>
    Effect.gen(function* () {
      const { ref } = yield* HttpRouter.params
      const found = yield* loadCustomerBooking(address, ref!)
      if (!found) return jsonError(404, 'not_found')
      return HttpServerResponse.jsonUnsafe({ booking: customerView(found.record, found.business) })
    }),
  )),

  HttpRouter.add('GET', '/public/my-bookings/:ref/slots', customerRoute((address) =>
    Effect.gen(function* () {
      const { ref } = yield* HttpRouter.params
      const found = yield* loadCustomerBooking(address, ref!)
      if (!found) return jsonError(404, 'not_found')
      const now = nowSec()
      const others = found.bookings.filter((b) => b.ref !== ref)
      const slots = computeSlots(found.service.availability, found.service.durationMinutes, now, takenRanges(others, now))
      return HttpServerResponse.jsonUnsafe({ slots })
    }),
  )),

  HttpRouter.add('POST', '/public/my-bookings/:ref/actions', customerRoute((address) =>
    Effect.gen(function* () {
      const { ref } = yield* HttpRouter.params
      const input = yield* HttpServerRequest.schemaBodyJson(ActionBody)
      const found = yield* loadCustomerBooking(address, ref!)
      if (!found) return jsonError(404, 'not_found')
      const { uid, record, bookings, business, service } = found
      if (!record.onchainId) return jsonError(409, 'not_onchain')
      if (bookings.some((b) => b.actionTx === input.txHash)) return jsonError(409, 'tx_already_recorded')

      const now = nowSec()
      const rpcUrl = yield* Bindings.pipe(Effect.map((b) => b.RPC_URL))
      const escrow = yield* Bindings.pipe(Effect.map((b) => b.ESCROW_ADDRESS))
      const verify = (topic: string) =>
        Effect.promise(() => verifyEventTx(rpcUrl, escrow, input.txHash, topic, record.onchainId!, address))

      let next: BookingRecord
      if (input.action === 'cancel') {
        if (record.status !== 'confirmed' && record.status !== 'pay_customer' && record.status !== 'pay_merchant') return jsonError(409, 'invalid_status')
        const v = yield* verify(CUSTOMER_CANCELLED_TOPIC)
        if (!v.ok) return jsonError(422, v.error)
        const refunded = BigInt(`0x${v.data.slice(2, 66)}`) === 1n
        next = { ...record, status: refunded ? 'pay_customer' : 'pay_merchant', cancelledRefund: refunded, actionTx: input.txHash }
      } else if (input.action === 'object') {
        if (record.status !== 'no_show_claimed' && record.status !== 'disputed') return jsonError(409, 'invalid_status')
        if (Date.parse(record.markedAt ?? '') / 1000 + 24 * 3600 <= now) return jsonError(409, 'window_closed')
        const v = yield* verify(NO_SHOW_OBJECTED_TOPIC)
        if (!v.ok) return jsonError(422, v.error)
        next = { ...record, status: 'disputed', actionTx: input.txHash }
      } else if (input.action === 'refund') {
        if (record.status !== 'merchant_cancelled' && record.status !== 'pay_customer') return jsonError(409, 'invalid_status')
        const v = yield* verify(REFUND_PARKED_TOPIC)
        if (!v.ok) return jsonError(422, v.error)
        next = { ...record, status: 'pay_customer', actionTx: input.txHash }
      } else if (input.action === 'claim') {
        if (record.status !== 'pay_customer' && record.status !== 'paid') return jsonError(409, 'invalid_status')
        const v = yield* verify(SETTLED_TOPIC)
        if (!v.ok) return jsonError(422, v.error)
        next = { ...record, status: 'paid', payee: 'customer', actionTx: input.txHash }
      } else {
        if (record.status !== 'merchant_cancelled' || (record.reschedules ?? 0) > 0) return jsonError(409, 'invalid_status')
        if (now >= record.scheduledAt) return jsonError(409, 'window_closed')
        const newAt = input.newScheduledAt
        if (newAt === undefined) return jsonError(400, 'invalid_body')
        const others = bookings.filter((b) => b.ref !== ref)
        const free = computeSlots(service.availability, service.durationMinutes, now, takenRanges(others, now))
        if (!free.includes(newAt)) return jsonError(409, 'slot_unavailable')
        const v = yield* verify(RESCHEDULED_TOPIC)
        if (!v.ok) return jsonError(422, v.error)
        if (BigInt(`0x${v.data.slice(2, 66)}`) !== BigInt(newAt)) return jsonError(422, 'tx_mismatch')
        next = { ...record, status: 'confirmed', scheduledAt: newAt, reschedules: 1, markedAt: undefined, actionTx: input.txHash }
      }

      yield* saveBookings(uid, bookings.map((b) => (b.ref === ref ? next : b)))
      return HttpServerResponse.jsonUnsafe({ booking: customerView(next, business) })
    }).pipe(Effect.catchTag('SchemaError', () => Effect.succeed(jsonError(400, 'invalid_body')))),
  )),

  HttpRouter.add('GET', '/me/bookings', authed((uid) =>
    listBookings(uid).pipe(
      Effect.flatMap((bookings) => syncBookings(uid, bookings)),
      Effect.map((bookings) => HttpServerResponse.jsonUnsafe({ bookings })),
    ),
  )),
)

const { handler } = HttpRouter.toWebHandler(routes, { disableLogger: true })

const parseOrigins = (raw: string | undefined): Set<string> =>
  new Set((raw ?? '').split(',').map((o) => o.trim()).filter(Boolean))

const corsHeaders = (origin: string | null, allowed: Set<string>): Headers => {
  const headers = new Headers()
  if (origin && allowed.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Vary', 'Origin')
  }
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-address, x-signature, x-timestamp')
  headers.set('Access-Control-Max-Age', '86400')
  return headers
}

export default {
  async fetch(request: Request, env: Env) {
    const origin = request.headers.get('Origin')
    const allowed = parseOrigins(env.ALLOWED_ORIGINS)
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin, allowed) })
    }
    const res = await handler(
      request,
      Context.make(Bindings, { DATA: env.DATA, PRIVY_APP_ID: env.PRIVY_APP_ID, RPC_URL: env.RPC_URL, ESCROW_ADDRESS: env.ESCROW_ADDRESS }),
    )
    const headers = new Headers(res.headers)
    corsHeaders(origin, allowed).forEach((value, key) => headers.set(key, value))
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
  },
} satisfies ExportedHandler<Env>
