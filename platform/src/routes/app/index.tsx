import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Onboarding } from '@/components/onboarding'
import { useApi } from '@/lib/use-api'
import { SKIP_ONBOARDING_KEY } from '@/lib/store'
import type { Business, Service } from '@/lib/types'

export const Route = createFileRoute('/app/')({
  component: Dashboard,
})

function Dashboard() {
  const call = useApi()
  const business = useQuery({
    queryKey: ['business'],
    queryFn: () => call<{ business: Business | null }>('/me/business'),
  })
  const services = useQuery({
    queryKey: ['services'],
    queryFn: () => call<{ services: Service[] }>('/me/services'),
  })
  const bookings = useQuery({
    queryKey: ['bookings'],
    queryFn: () => call<{ bookings: unknown[] }>('/me/bookings'),
  })

  if (business.isPending) return <Skeleton className="h-40 w-full" />

  const profile = business.data?.business
  const skipped = localStorage.getItem(SKIP_ONBOARDING_KEY) === '1'

  if (!profile && !skipped) return <Onboarding />

  return (
    <div className="flex flex-col gap-4">
      {!profile && (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-4">
            <p className="text-sm text-muted-foreground">Business profile not filled in yet.</p>
            <Button variant="outline" onClick={() => { localStorage.removeItem(SKIP_ONBOARDING_KEY); location.reload() }}>
              Fill in now
            </Button>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{profile?.name ?? 'Your business'}</CardTitle>
          <CardDescription>{profile?.tagline ?? '—'}</CardDescription>
        </CardHeader>
      </Card>
      <div className="grid grid-cols-2 gap-3">
        <Link to="/app/service">
          <Card>
            <CardHeader>
              <CardDescription>Service</CardDescription>
              <CardTitle className="text-3xl">{services.data?.services.length ?? 0}</CardTitle>
            </CardHeader>
          </Card>
        </Link>
        <Link to="/app/booking">
          <Card>
            <CardHeader>
              <CardDescription>Booking</CardDescription>
              <CardTitle className="text-3xl">{bookings.data?.bookings.length ?? 0}</CardTitle>
            </CardHeader>
          </Card>
        </Link>
      </div>
    </div>
  )
}
