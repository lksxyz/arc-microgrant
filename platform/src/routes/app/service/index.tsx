import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useApi } from '@/lib/use-api'
import { emptyService, WEEKDAYS, type Service } from '@/lib/types'
import { PublicLink } from '@/components/public-link'

export const Route = createFileRoute('/app/service/')({
  component: ServiceList,
})

function ServiceList() {
  const call = useApi()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const q = useQuery({
    queryKey: ['services'],
    queryFn: () => call<{ services: Service[] }>('/me/services'),
  })

  const create = useMutation({
    mutationFn: () => call<{ service: Service }>('/me/services', { method: 'POST', body: { ...emptyService(), name: 'New service' } }),
    onSuccess: async ({ service }) => {
      await qc.invalidateQueries({ queryKey: ['services'] })
      navigate({ to: '/app/service/$id', params: { id: service.id } })
    },
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Service</h1>
        <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending}>
          Add
        </Button>
      </div>
      {q.isPending && <Skeleton className="h-24 w-full" />}
      {q.data?.services.length === 0 && (
        <p className="text-sm text-muted-foreground">No services yet. Add one to get started.</p>
      )}
      {q.data?.services.map((s) => (
        <Card key={s.id}>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <Link to="/app/service/$id" params={{ id: s.id }}>
                  <CardTitle className="text-base">{s.name}</CardTitle>
                </Link>
                <Badge variant={s.active ? 'default' : 'secondary'}>{s.active ? 'Active' : 'Inactive'}</Badge>
              </div>
              <CardDescription>
                {s.durationMinutes} min · {s.priceUsdc} USDC · deposit {s.depositUsdc} USDC
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-xs text-muted-foreground">
              {s.availability.days.map((d) => WEEKDAYS[d]).join(', ')} · {s.availability.start}–{s.availability.end}
              <PublicLink serviceId={s.id} active={s.active} />
            </CardContent>
        </Card>
      ))}
    </div>
  )
}
