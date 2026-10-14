import { Data, Effect } from 'effect'
import { verifyMessage } from 'viem'
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { Bindings } from './env'

export class Unauthorized extends Data.TaggedError('Unauthorized')<{ readonly reason: string }> {}

const jwksCache = new Map<string, JWTVerifyGetKey>()

const jwksFor = (appId: string) => {
  let jwks = jwksCache.get(appId)
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://auth.privy.io/api/v1/apps/${appId}/jwks.json`))
    jwksCache.set(appId, jwks)
  }
  return jwks
}

export const verifyBearer = (token: string, appId: string) =>
  Effect.tryPromise({
    try: () => jwtVerify(token, jwksFor(appId), { issuer: 'privy.io', audience: appId }),
    catch: (e) => new Unauthorized({ reason: String(e) }),
  }).pipe(
    Effect.flatMap(({ payload }) =>
      typeof payload.sub === 'string'
        ? Effect.succeed(payload.sub)
        : Effect.fail(new Unauthorized({ reason: 'missing sub' })),
    ),
  )

export const bearerFrom = (header: string | undefined) =>
  header?.startsWith('Bearer ') ? Effect.succeed(header.slice(7)) : Effect.fail(new Unauthorized({ reason: 'missing bearer' }))

export const currentUserId = (authorization: string | undefined) =>
  Effect.gen(function* () {
    const { PRIVY_APP_ID } = yield* Bindings
    const token = yield* bearerFrom(authorization)
    return yield* verifyBearer(token, PRIVY_APP_ID)
  })

export const CUSTOMER_AUTH_WINDOW_SEC = 600

export const customerMessage = (ts: number) => `Intensio my-bookings ${ts}`

export const verifyCustomerSignature = (headers: {
  address: string | undefined
  signature: string | undefined
  timestamp: string | undefined
}) =>
  Effect.tryPromise({
    try: async () => {
      const { address, signature, timestamp } = headers
      if (!address || !signature || !timestamp) throw new Error('missing')
      const ts = Number(timestamp)
      const now = Math.floor(Date.now() / 1000)
      if (!Number.isFinite(ts) || Math.abs(now - ts) > CUSTOMER_AUTH_WINDOW_SEC) throw new Error('expired')
      const ok = await verifyMessage({ address: address as `0x${string}`, message: customerMessage(ts), signature: signature as `0x${string}` })
      if (!ok) throw new Error('bad signature')
      return address.toLowerCase()
    },
    catch: (e) => new Unauthorized({ reason: String(e) }),
  })
