import { createFileRoute, Link } from '@tanstack/react-router'
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePrivy, useWallets, type ConnectedWallet } from '@privy-io/react-auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { customerFetch } from '@/lib/customer-api'
import { statusLabel, dateFmt } from '@/lib/customer-status'

export const Route = createFileRoute('/my-bookings/')({
  component: MyBookings,
})

type CustomerBooking = {
  ref: string
  status: string
  serviceName: string
  scheduledAt: number
  durationMinutes: number
  deposit: string
  merchantName: string | null
}

function MyBookings() {
  const { authenticated, login } = usePrivy()
  const { wallets } = useWallets()
  const wallet = useMemo<ConnectedWallet | undefined>(
    () => wallets.find((w) => w.walletClientType !== 'privy') ?? wallets[0],
    [wallets],
  )

  const q = useQuery({
    queryKey: ['my-bookings', wallet?.address],
    queryFn: () => customerFetch<{ bookings: CustomerBooking[] }>(wallet!, '/public/my-bookings'),
    enabled: !!wallet,
  })

  const list = [...(q.data?.bookings ?? [])].sort((a, b) => b.scheduledAt - a.scheduledAt)

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-10">
      <h1 className="text-xl font-semibold">My bookings</h1>

      {!authenticated && (
        <Button size="lg" onClick={() => login()}>
          Log in or connect a wallet
        </Button>
      )}
      {authenticated && !wallet && <p className="text-sm text-muted-foreground">Waiting for wallet…</p>}
      {wallet && q.isPending && <Skeleton className="h-24 w-full" />}
      {q.isError && <p className="text-sm text-destructive">Failed to load bookings. Try logging in again.</p>}
      {q.data && list.length === 0 && (
        <p className="text-sm text-muted-foreground">No bookings for this wallet yet.</p>
      )}

      {list.map((b) => {
        const st = statusLabel(b.status)
        return (
          <Link key={b.ref} to="/my-bookings/$ref" params={{ ref: b.ref }}>
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">{b.serviceName}</CardTitle>
                  <Badge variant={st.variant}>{st.label}</Badge>
                </div>
                <CardDescription>
                  {b.merchantName ?? '—'} · {dateFmt.format(new Date(b.scheduledAt * 1000))} GMT+7
                </CardDescription>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Deposit {Number(b.deposit) / 1_000_000} USDC · {b.durationMinutes} min
              </CardContent>
            </Card>
          </Link>
        )
      })}
    </main>
  )
}
