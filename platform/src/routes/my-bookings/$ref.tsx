import { createFileRoute, Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { usePrivy, useWallets, type ConnectedWallet } from '@privy-io/react-auth'
import { createPublicClient, createWalletClient, custom, http, type Address } from 'viem'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { customerFetch } from '@/lib/customer-api'
import { appChain, escrowAbi, ESCROW_ADDRESS } from '@/lib/chain'
import { dateFmt, statusLabel } from '@/lib/customer-status'
import { timeGate } from '@/lib/flags'
import { TxLink } from '@/components/tx-link'

export const Route = createFileRoute('/my-bookings/$ref')({
  component: MyBookingDetail,
})

type Booking = {
  ref: string
  status: string
  serviceName: string
  scheduledAt: number
  durationMinutes: number
  deposit: string
  customerName: string
  onchainId: string | null
  txHash: string | null
  actionTx: string | null
  checkedInAt: string | null
  markedAt: string | null
  cancelledRefund: boolean | null
  payee: 'merchant' | 'customer' | null
  claimDelay: number
  reschedules: number
  merchantName: string | null
}

type Action = 'cancel' | 'object' | 'refund' | 'reschedule' | 'claim'

const DAY = 24 * 3600
const OBJECTION_SEC = DAY
const CANCEL_REFUND_CUTOFF_SEC = DAY

const fnFor: Record<Action, 'cancelByCustomer' | 'objectNoShow' | 'refundAfterMerchantCancel' | 'reschedule' | 'claimRefund'> = {
  cancel: 'cancelByCustomer',
  object: 'objectNoShow',
  refund: 'refundAfterMerchantCancel',
  reschedule: 'reschedule',
  claim: 'claimRefund',
}

function MyBookingDetail() {
  const { ref } = Route.useParams()
  const qc = useQueryClient()
  const { authenticated, login } = usePrivy()
  const { wallets } = useWallets()
  const wallet = useMemo<ConnectedWallet | undefined>(
    () => wallets.find((w) => w.walletClientType !== 'privy') ?? wallets[0],
    [wallets],
  )
  const [error, setError] = useState<string | null>(null)
  const [newSlot, setNewSlot] = useState<number | null>(null)

  const q = useQuery({
    queryKey: ['my-booking', ref, wallet?.address],
    queryFn: () => customerFetch<{ booking: Booking }>(wallet!, `/public/my-bookings/${ref}`),
    enabled: !!wallet,
  })

  const b = q.data?.booking
  const canReschedule = b?.status === 'merchant_cancelled' && b.reschedules === 0

  const slotsQ = useQuery({
    queryKey: ['my-booking-slots', ref, wallet?.address],
    queryFn: () => customerFetch<{ slots: number[] }>(wallet!, `/public/my-bookings/${ref}/slots`),
    enabled: !!wallet && canReschedule,
  })

  const act = useMutation({
    mutationFn: async ({ action, newScheduledAt }: { action: Action; newScheduledAt?: number }) => {
      if (!wallet || !b?.onchainId) throw new Error('Wallet not available')
      await wallet.switchChain(appChain.id)
      const provider = await wallet.getEthereumProvider()
      const walletClient = createWalletClient({ account: wallet.address as Address, chain: appChain, transport: custom(provider) })
      const publicClient = createPublicClient({ chain: appChain, transport: http() })
      const id = BigInt(b.onchainId)
      const txHash = await walletClient.writeContract(
        action === 'reschedule'
          ? { address: ESCROW_ADDRESS, abi: escrowAbi, functionName: 'reschedule', args: [id, newScheduledAt!] }
          : { address: ESCROW_ADDRESS, abi: escrowAbi, functionName: fnFor[action], args: [id] },
      )
      await publicClient.waitForTransactionReceipt({ hash: txHash })
      return customerFetch(wallet, `/public/my-bookings/${ref}/actions`, {
        method: 'POST',
        body: { action, txHash, newScheduledAt },
      })
    },
    onSuccess: async () => {
      setError(null)
      setNewSlot(null)
      await qc.invalidateQueries({ queryKey: ['my-booking', ref] })
      await qc.invalidateQueries({ queryKey: ['my-bookings'] })
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Transaction failed'),
  })

  if (!authenticated) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-10">
        <Button size="lg" onClick={() => login()}>Log in or connect a wallet</Button>
      </main>
    )
  }
  if (!wallet || q.isPending) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-10">
        <Skeleton className="h-96 w-full" />
      </main>
    )
  }
  if (q.isError || !b) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-10">
        <p className="text-sm text-destructive">Booking not found for this wallet.</p>
      </main>
    )
  }

  const now = Math.floor(Date.now() / 1000)
  const st = statusLabel(b.status)
  const busy = act.isPending
  const markedSec = b.markedAt ? Date.parse(b.markedAt) / 1000 : 0
  const canObject = b.status === 'no_show_claimed' && timeGate(now < markedSec + OBJECTION_SEC)
  const canCancel = b.status === 'confirmed' && b.onchainId !== null && timeGate(now < b.scheduledAt)
  const cancelRefunds = b.scheduledAt - now > CANCEL_REFUND_CUTOFF_SEC

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-10">
      <Link to="/my-bookings" className="text-sm text-muted-foreground">← My bookings</Link>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-xl">{b.serviceName}</CardTitle>
            <Badge variant={st.variant}>{st.label}</Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <dl className="grid grid-cols-2 gap-3">
            <dt className="text-muted-foreground">Merchant</dt>
            <dd>{b.merchantName ?? '—'}</dd>
            <dt className="text-muted-foreground">Name</dt>
            <dd>{b.customerName}</dd>
            <dt className="text-muted-foreground">Schedule</dt>
            <dd>{dateFmt.format(new Date(b.scheduledAt * 1000))} GMT+7</dd>
            <dt className="text-muted-foreground">Duration</dt>
            <dd>{b.durationMinutes} min</dd>
            <dt className="text-muted-foreground">Deposit</dt>
            <dd>{Number(b.deposit) / 1_000_000} USDC</dd>
            {b.onchainId && (
              <>
                <dt className="text-muted-foreground">Booking #</dt>
                <dd>{b.onchainId}</dd>
              </>
            )}
          </dl>

          <div className="flex flex-col gap-2 rounded-md border p-3">
            {b.txHash && <TxLink hash={b.txHash} label="Deposit transaction" />}
            {b.actionTx && <TxLink hash={b.actionTx} label="Last action transaction" />}
            {!b.txHash && <p className="text-xs text-muted-foreground">No transactions yet.</p>}
          </div>

          {b.status === 'confirmed' && b.checkedInAt && <p className="text-muted-foreground">Already checked in.</p>}

          {b.status === 'confirmed' && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                {cancelRefunds
                  ? 'Cancel now: the full deposit is refunded.'
                  : 'Cancel less than 24 hours before the slot: the deposit is forfeited to the merchant.'}
              </p>
              <Button
                variant="destructive"
                disabled={!canCancel || busy}
                onClick={() => act.mutate({ action: 'cancel' })}
              >
                {busy ? 'Processing…' : 'Cancel booking'}
              </Button>
            </div>
          )}

          {b.status === 'no_show_claimed' && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                The merchant marked you as a no-show. Dispute within 24 hours if this is wrong.
              </p>
              <Button disabled={!canObject || busy} onClick={() => act.mutate({ action: 'object' })}>
                {busy ? 'Processing…' : 'Dispute no-show'}
              </Button>
            </div>
          )}

          {b.status === 'merchant_cancelled' && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">The merchant cancelled this slot. Choose a refund or a new time.</p>
              <Button disabled={busy} onClick={() => act.mutate({ action: 'refund' })}>
                {busy ? 'Processing…' : 'Full refund'}
              </Button>

              {canReschedule && timeGate(now < b.scheduledAt) && (
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium">Choose a new time (one time only)</p>
                  {slotsQ.isPending && <Skeleton className="h-16 w-full" />}
                  {slotsQ.data?.slots.length === 0 && <p className="text-xs text-muted-foreground">No open slots.</p>}
                  <div className="grid grid-cols-2 gap-2">
                    {slotsQ.data?.slots.slice(0, 20).map((t) => (
                      <Button key={t} size="sm" variant={newSlot === t ? 'default' : 'outline'} onClick={() => setNewSlot(t)}>
                        {dateFmt.format(new Date(t * 1000))}
                      </Button>
                    ))}
                  </div>
                  <Button disabled={newSlot === null || busy} onClick={() => newSlot !== null && act.mutate({ action: 'reschedule', newScheduledAt: newSlot })}>
                    Move to this slot
                  </Button>
                </div>
              )}
            </div>
          )}

          {b.status === 'pay_customer' && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">Your refund is ready. Claim it anytime.</p>
              <Button disabled={busy} onClick={() => act.mutate({ action: 'claim' })}>
                {busy ? 'Processing…' : 'Claim refund'}
              </Button>
            </div>
          )}
          {b.status === 'pay_merchant' && (
            <p className="text-muted-foreground">Funds are being processed. The merchant claims on schedule.</p>
          )}
          {b.status === 'paid' && (
            <p className="text-muted-foreground">
              {b.payee === 'customer' ? 'You claimed the refund.' : 'The merchant claimed the funds.'}
            </p>
          )}
          {b.status === 'disputed' && <p className="text-muted-foreground">The dispute is under admin review.</p>}
          {b.status === 'refunded' && <p className="text-muted-foreground">The deposit has been returned.</p>}
          {b.status === 'cancelled_by_customer' && (
            <p className="text-muted-foreground">
              {b.cancelledRefund ? 'Cancelled, deposit refunded.' : 'Cancelled, deposit forfeited to the merchant.'}
            </p>
          )}

          {error && <p className="text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </main>
  )
}
