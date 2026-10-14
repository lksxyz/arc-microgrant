import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { usePrivy, useWallets, type ConnectedWallet } from '@privy-io/react-auth'
import { createPublicClient, createWalletClient, custom, http, type Address } from 'viem'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useApi } from '@/lib/use-api'
import { appChain, escrowAbi, ESCROW_ADDRESS } from '@/lib/chain'
import type { Business } from '@/lib/types'
import { timeGate } from '@/lib/flags'
import { TxLink } from '@/components/tx-link'

export const Route = createFileRoute('/app/booking')({
  component: Bookings,
})

type Booking = {
  ref: string
  status: 'pending' | 'confirmed' | 'no_show_claimed' | 'merchant_cancelled' | 'disputed' | 'pay_merchant' | 'pay_customer' | 'paid'
  serviceName: string
  scheduledAt: number
  durationMinutes: number
  deposit: string
  customerName: string
  expiresAt: string
  customerAddress?: string
  onchainId?: string
  txHash?: string
  actionTx?: string
  checkedInAt?: string
  claimDelay?: number
  payee?: 'merchant' | 'customer'
}

const NO_SHOW_GRACE_SEC = 15 * 60

const dateFmt = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Jakarta',
})

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

function statusBadge(b: Booking, now: number) {
  switch (b.status) {
    case 'pending':
      return Date.parse(b.expiresAt) > now
        ? { label: 'Awaiting payment', variant: 'secondary' as const }
        : { label: 'Expired', variant: 'outline' as const }
    case 'confirmed':
      return b.checkedInAt ? { label: 'Checked in', variant: 'default' as const } : { label: 'Confirmed', variant: 'default' as const }
    case 'no_show_claimed':
      return { label: 'No-show', variant: 'destructive' as const }
    case 'merchant_cancelled':
      return { label: 'Cancelled', variant: 'outline' as const }
    case 'disputed':
      return { label: 'Disputed', variant: 'secondary' as const }
    case 'pay_merchant':
      return { label: 'Siap diklaim', variant: 'default' as const }
    case 'pay_customer':
      return { label: b.checkedInAt ? 'Checked in, deposit refunded' : 'Refund to customer', variant: 'outline' as const }
    case 'paid':
      return { label: b.payee === 'customer' ? 'Refund completed' : 'Funds claimed', variant: 'outline' as const }
  }
}

function Bookings() {
  const call = useApi()
  const qc = useQueryClient()
  const { authenticated, login } = usePrivy()
  const { wallets } = useWallets()
  const [error, setError] = useState<string | null>(null)
  const [busyRef, setBusyRef] = useState<string | null>(null)

  const q = useQuery({
    queryKey: ['bookings'],
    queryFn: () => call<{ bookings: Booking[] }>('/me/bookings'),
  })
  const biz = useQuery({
    queryKey: ['business'],
    queryFn: () => call<{ business: Business | null }>('/me/business'),
  })

  const payout = biz.data?.business?.payoutAddress?.toLowerCase()
  const wallet = useMemo<ConnectedWallet | undefined>(
    () => wallets.find((w) => w.address.toLowerCase() === payout),
    [wallets, payout],
  )

  const now = Date.now()
  const nowSec = Math.floor(now / 1000)
  const bookings = [...(q.data?.bookings ?? [])].sort((a, b) => a.scheduledAt - b.scheduledAt)

  const refresh = () => qc.invalidateQueries({ queryKey: ['bookings'] })

  const onchain = useMutation({
    mutationFn: async ({
      ref,
      onchainId,
      fn,
      path,
    }: {
      ref: string
      onchainId: string
      fn: 'markNoShow' | 'cancelByMerchant' | 'checkIn' | 'claimMerchant'
      path: 'no-show' | 'cancel' | 'checkin' | 'claim'
    }) => {
      if (!wallet) throw new Error('Connect the payout wallet')
      await wallet.switchChain(appChain.id)
      const provider = await wallet.getEthereumProvider()
      const walletClient = createWalletClient({ account: wallet.address as Address, chain: appChain, transport: custom(provider) })
      const publicClient = createPublicClient({ chain: appChain, transport: http() })
      const txHash = await walletClient.writeContract({
        address: ESCROW_ADDRESS,
        abi: escrowAbi,
        functionName: fn,
        args: [BigInt(onchainId)],
      })
      await publicClient.waitForTransactionReceipt({ hash: txHash })
      return call(`/me/bookings/${ref}/${path}`, { method: 'POST', body: { txHash } })
    },
    onSuccess: () => {
      setError(null)
      refresh()
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Transaction failed'),
    onSettled: () => setBusyRef(null),
  })

  const run = (ref: string, args: Parameters<typeof onchain.mutate>[0]) => {
    setError(null)
    setBusyRef(ref)
    onchain.mutate(args)
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Booking</h1>

      {authenticated && payout && !wallet && (
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground">
            Merchant actions need the payout wallet ({shortAddr(payout)}). Log in with that wallet.
          </CardContent>
        </Card>
      )}
      {!authenticated && (
        <Button variant="outline" onClick={() => login()}>
          Log in with payout wallet
        </Button>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {q.isPending && <Skeleton className="h-24 w-full" />}
      {q.data && bookings.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">No incoming bookings yet.</CardContent>
        </Card>
      )}

      {bookings.map((b) => {
        const st = statusBadge(b, now)
        const started = nowSec >= b.scheduledAt
        const canNoShow = b.status === 'confirmed' && !b.checkedInAt && timeGate(nowSec >= b.scheduledAt + NO_SHOW_GRACE_SEC)
        const canCancel = b.status === 'confirmed' && timeGate(!started)
        const canCheckin = b.status === 'confirmed' && !b.checkedInAt && timeGate(nowSec >= b.scheduledAt - 30 * 60 && nowSec < b.scheduledAt + 24 * 3600)
        const claimAt = b.scheduledAt + (b.claimDelay ?? 0)
        const claimReady = nowSec >= claimAt
        const canClaim = b.status === 'pay_merchant' && timeGate(claimReady)
        const busy = busyRef === b.ref

        return (
          <Card key={b.ref}>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">{b.customerName}</CardTitle>
                <Badge variant={st.variant}>{st.label}</Badge>
              </div>
              <CardDescription>
                {b.serviceName} · {dateFmt.format(new Date(b.scheduledAt * 1000))} GMT+7 · {b.durationMinutes} min
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>Deposit {Number(b.deposit) / 1_000_000} USDC</span>
                {b.onchainId && <span>Booking #{b.onchainId}</span>}
                {b.customerAddress && <span>Customer {shortAddr(b.customerAddress)}</span>}
              </div>
              {(b.txHash || b.actionTx) && (
                <div className="flex flex-col gap-1">
                  {b.txHash && <TxLink hash={b.txHash} label="Deposit transaction" />}
                  {b.actionTx && <TxLink hash={b.actionTx} label="Last action transaction" />}
                </div>
              )}

              {b.status === 'confirmed' && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={!canCheckin || !wallet || busy}
                    onClick={() => run(b.ref, { ref: b.ref, onchainId: b.onchainId!, fn: 'checkIn', path: 'checkin' })}
                  >
                    Check-in
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={!canNoShow || !wallet || busy}
                    title={canNoShow ? undefined : 'Available 15 minutes after start time'}
                    onClick={() => run(b.ref, { ref: b.ref, onchainId: b.onchainId!, fn: 'markNoShow', path: 'no-show' })}
                  >
                    No-show
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canCancel || !wallet || busy}
                    title={canCancel ? undefined : 'Only before start time'}
                    onClick={() => run(b.ref, { ref: b.ref, onchainId: b.onchainId!, fn: 'cancelByMerchant', path: 'cancel' })}
                  >
                    Cancel
                  </Button>
                </div>
              )}

              {b.status === 'pay_merchant' && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-muted-foreground">
                    {claimReady
                      ? 'Deposit can be claimed now.'
                      : `Claimable from ${dateFmt.format(new Date(claimAt * 1000))}.`}
                  </p>
                  <Button
                    size="sm"
                    disabled={!canClaim || !wallet || busy}
                    onClick={() => run(b.ref, { ref: b.ref, onchainId: b.onchainId!, fn: 'claimMerchant', path: 'claim' })}
                  >
                    Claim deposit
                  </Button>
                </div>
              )}

              {b.status === 'merchant_cancelled' && (
                <p className="text-xs text-muted-foreground">Waiting for the customer to choose a refund or a new time.</p>
              )}
              {b.status === 'no_show_claimed' && (
                <p className="text-xs text-muted-foreground">No-show claimed. The customer has 24 hours to dispute.</p>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
