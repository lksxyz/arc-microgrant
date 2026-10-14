import { createFileRoute, Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { usePrivy, useWallets, type ConnectedWallet } from '@privy-io/react-auth'
import { createPublicClient, createWalletClient, custom, http, parseUnits, type Address } from 'viem'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { apiFetch } from '@/lib/api'
import { appChain, erc20Abi, escrowAbi, ESCROW_ADDRESS, USDC_ADDRESS } from '@/lib/chain'
import { TxLink } from '@/components/tx-link'

export const Route = createFileRoute('/d/$ref')({
  component: DepositPage,
})

type Deposit = {
  status: 'pending' | 'confirmed' | 'expired'
  ref: string
  expiresAt: string
  scheduledAt: number
  customerName: string
  onchainId: string | null
  txHash: string | null
  claimDelay: number
  business: { name: string } | null
  payoutAddress: string | null
  service: { name: string; durationMinutes: number; priceUsdc: string; depositUsdc: string }
}

const dateFmt = new Intl.DateTimeFormat('en-US', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })

function DepositPage() {
  const { ref } = Route.useParams()
  const qc = useQueryClient()
  const { authenticated, login } = usePrivy()
  const { wallets } = useWallets()
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState('')

  const q = useQuery({
    queryKey: ['deposit', ref],
    queryFn: () => apiFetch<Deposit>(`/public/deposits/${ref}`),
    retry: false,
  })

  const wallet = useMemo<ConnectedWallet | undefined>(
    () => wallets.find((w) => w.walletClientType !== 'privy') ?? wallets[0],
    [wallets],
  )

  const pay = useMutation({
    mutationFn: async () => {
      if (!wallet || !q.data?.payoutAddress) throw new Error('wallet')
      const { service, payoutAddress, scheduledAt, claimDelay } = q.data
      const deposit = parseUnits(service.depositUsdc, 6)
      const account = wallet.address as Address

      await wallet.switchChain(appChain.id)
      const provider = await wallet.getEthereumProvider()
      const walletClient = createWalletClient({ account, chain: appChain, transport: custom(provider) })
      const publicClient = createPublicClient({ chain: appChain, transport: http() })

      setStep('Menyiapkan approve USDC…')
      const allowance = await publicClient.readContract({
        address: USDC_ADDRESS, abi: erc20Abi, functionName: 'allowance', args: [account, ESCROW_ADDRESS],
      })
      if (allowance < deposit) {
        const approveHash = await walletClient.writeContract({
          address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [ESCROW_ADDRESS, deposit],
        })
        await publicClient.waitForTransactionReceipt({ hash: approveHash })
      }

      setStep('Mengirim deposit…')
      const txHash = await walletClient.writeContract({
        address: ESCROW_ADDRESS,
        abi: escrowAbi,
        functionName: 'createBooking',
        args: [payoutAddress as Address, deposit, scheduledAt, claimDelay],
      })
      await publicClient.waitForTransactionReceipt({ hash: txHash })

      setStep('Mengonfirmasi booking…')
      return apiFetch(`/public/deposits/${ref}/confirm`, {
        method: 'POST',
        body: { txHash, customerAddress: account },
      })
    },
    onSuccess: async () => {
      setStep('')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['deposit', ref] })
    },
    onError: (e) => {
      setStep('')
      setError(e instanceof Error ? e.message : 'Failed, please try again.')
    },
  })

  if (q.isPending) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-10">
        <Skeleton className="h-96 w-full" />
      </main>
    )
  }
  if (q.isError) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-10">
        <p className="text-sm text-destructive">Invalid deposit link.</p>
      </main>
    )
  }

  const d = q.data
  const when = dateFmt.format(new Date(d.scheduledAt * 1000))

  if (d.status === 'confirmed') {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-10">
        <Card>
          <CardHeader>
            <CardTitle>Booking terkonfirmasi</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p>{d.service.name} · {when}</p>
            <p>Deposit {d.service.depositUsdc} USDC is held in escrow. Booking #{d.onchainId}.</p>
            <p className="text-muted-foreground">Keep this number for disputes or rescheduling.</p>
            {d.txHash && <TxLink hash={d.txHash} label="Deposit transaction" />}
            <Button variant="outline" className="mt-2 w-full" render={<Link to="/my-bookings" />}>
              View my bookings
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  if (d.status === 'expired') {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-10">
        <Card>
          <CardHeader>
            <CardTitle>Payment window expired</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            The slot at {when} was released. Please pick a new time from the booking link.
            <Button variant="outline" className="mt-4 w-full" render={<Link to="/my-bookings" />}>
              View my bookings
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-10">
      {d.business && <p className="text-sm text-muted-foreground">{d.business.name}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Bayar deposit</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <dl className="grid grid-cols-2 gap-3">
            <dt className="text-muted-foreground">Service</dt>
            <dd>{d.service.name}</dd>
            <dt className="text-muted-foreground">Name</dt>
            <dd>{d.customerName}</dd>
            <dt className="text-muted-foreground">Schedule</dt>
            <dd>{when}</dd>
            <dt className="text-muted-foreground">Deposit</dt>
            <dd>
              <Badge variant="secondary">{d.service.depositUsdc} USDC</Badge>
            </dd>
          </dl>
          <p className="text-xs text-muted-foreground">
            Payment deadline: {dateFmt.format(new Date(d.expiresAt))}. The deposit is held in escrow on-chain.
          </p>

          {!d.payoutAddress && <p className="text-destructive">The merchant has not set a payout wallet yet.</p>}

          {d.payoutAddress && !authenticated && (
            <Button size="lg" onClick={() => login()}>
              Log in or connect a wallet
            </Button>
          )}

          {d.payoutAddress && authenticated && (
            <>
              {!wallet && <p className="text-muted-foreground">Waiting for wallet…</p>}
              <Button size="lg" className="w-full" disabled={!wallet || pay.isPending} onClick={() => pay.mutate()}>
                {pay.isPending ? step || 'Processing…' : `Pay ${d.service.depositUsdc} USDC`}
              </Button>
              {error && <p className="text-destructive">{error}</p>}
            </>
          )}
          <Button variant="ghost" render={<Link to="/my-bookings" />}>
            View my bookings
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
