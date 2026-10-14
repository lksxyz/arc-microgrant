import { Context } from 'effect'

export class Bindings extends Context.Service<
  Bindings,
  { readonly DATA: KVNamespace; readonly PRIVY_APP_ID: string; readonly RPC_URL: string; readonly ESCROW_ADDRESS: string }
>()('Bindings') {}

export interface Env {
  readonly DATA: KVNamespace
  readonly PRIVY_APP_ID: string
  readonly RPC_URL: string
  readonly ESCROW_ADDRESS: string
  readonly ALLOWED_ORIGINS?: string
}
