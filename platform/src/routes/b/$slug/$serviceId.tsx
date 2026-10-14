import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { apiFetch } from '@/lib/api'
import { WEEKDAYS, type Availability } from '@/lib/types'

export const Route = createFileRoute('/b/$slug/$serviceId')({
  component: PublicBooking,
})

type PublicBookingData = {
  business: { name: string; tagline: string } | null
  service: {
    id: string
    name: string
    description?: string
    durationMinutes: number
    priceUsdc: string
    depositUsdc: string
    availability: Availability
  }
}

const dateFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Jakarta' })
const timeFmt = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })

function PublicBooking() {
  const { slug, serviceId } = Route.useParams()
  const navigate = useNavigate()
  const base = `/public/b/${slug}/services/${serviceId}`
  const [selected, setSelected] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const q = useQuery({
    queryKey: ['public-booking', slug, serviceId],
    queryFn: () => apiFetch<PublicBookingData>(base),
    retry: false,
  })

  const slotsQ = useQuery({
    queryKey: ['public-slots', slug, serviceId],
    queryFn: () => apiFetch<{ slots: number[] }>(`${base}/slots`),
    enabled: q.isSuccess,
  })

  const reserve = useMutation({
    mutationFn: () =>
      apiFetch<{ ref: string }>(`${base}/reservations`, {
        method: 'POST',
        body: { scheduledAt: selected, customerName: name.trim() },
      }),
    onSuccess: ({ ref }) => navigate({ to: '/d/$ref', params: { ref } }),
    onError: (e) => setError(e instanceof Error && e.message.includes('slot_unavailable') ? 'This slot was just taken. Please choose another.' : 'Failed to create booking. Please try again.'),
  })

  const grouped = useMemo(() => {
    const map = new Map<string, number[]>()
    for (const t of slotsQ.data?.slots ?? []) {
      const key = dateFmt.format(new Date(t * 1000))
      map.set(key, [...(map.get(key) ?? []), t])
    }
    return [...map.entries()]
  }, [slotsQ.data])

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
        <p className="text-sm text-destructive">Service not found or currently inactive.</p>
      </main>
    )
  }

  const { business, service: s } = q.data
  const days = s.availability.days.map((d) => WEEKDAYS[d]).join(', ')
  const canSubmit = selected !== null && name.trim().length > 0 && !reserve.isPending

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-10">
      {business && (
        <header className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">{business.name}</p>
          {business.tagline && <p className="text-sm">{business.tagline}</p>}
        </header>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{s.name}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {s.description && <p className="text-sm text-muted-foreground">{s.description}</p>}
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <dt className="text-muted-foreground">Duration</dt>
            <dd>{s.durationMinutes} min</dd>
            <dt className="text-muted-foreground">Price</dt>
            <dd>{s.priceUsdc} USDC</dd>
            <dt className="text-muted-foreground">Deposit</dt>
            <dd>
              <Badge variant="secondary">{s.depositUsdc} USDC</Badge>
            </dd>
            <dt className="text-muted-foreground">Schedule</dt>
            <dd>
              {days}, {s.availability.start}–{s.availability.end}
            </dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Data & jadwal</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="c-name">Name</Label>
            <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
          </div>

          {slotsQ.isPending && <Skeleton className="h-24 w-full" />}
          {slotsQ.data && grouped.length === 0 && <p className="text-sm text-muted-foreground">No open slots.</p>}
          {grouped.map(([day, times]) => (
            <div key={day} className="flex flex-col gap-2">
              <p className="text-sm font-medium">{day}</p>
              <div className="grid grid-cols-3 gap-2">
                {times.map((t) => (
                  <Button key={t} size="sm" variant={selected === t ? 'default' : 'outline'} onClick={() => setSelected(t)}>
                    {timeFmt.format(new Date(t * 1000))}
                  </Button>
                ))}
              </div>
            </div>
          ))}

          <Button size="lg" className="w-full" disabled={!canSubmit} onClick={() => reserve.mutate()}>
            {reserve.isPending ? 'Processing…' : `Continue to pay ${s.depositUsdc} USDC deposit`}
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <p className="text-xs text-muted-foreground">The slot is held for 15 minutes while you pay the deposit.</p>
        </CardContent>
      </Card>
    </main>
  )
}
