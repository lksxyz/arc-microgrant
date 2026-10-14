import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ServiceForm } from '@/components/service-form'
import { useApi } from '@/lib/use-api'
import type { Service, ServiceInput } from '@/lib/types'
import { PublicLink } from '@/components/public-link'

export const Route = createFileRoute('/app/service/$id')({
  component: ServiceEdit,
})

function ServiceEdit() {
  const { id } = Route.useParams()
  const call = useApi()
  const qc = useQueryClient()
  const navigate = useNavigate()

  const q = useQuery({
    queryKey: ['service', id],
    queryFn: () => call<{ service: Service }>(`/me/services/${id}`),
  })

  const update = useMutation({
    mutationFn: (input: ServiceInput) =>
      call<{ service: Service }>(`/me/services/${id}`, { method: 'PUT', body: input }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['services'] })
      await qc.invalidateQueries({ queryKey: ['service', id] })
    },
  })

  const remove = useMutation({
    mutationFn: () => call(`/me/services/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['services'] })
      navigate({ to: '/app/service' })
    },
  })

  if (q.isPending) return <Skeleton className="h-80 w-full" />
  if (q.isError) return <p className="text-sm text-destructive">Service not found.</p>

  const s = q.data.service
  const { id: _id, ...initial } = s

  return (
    <div className="flex flex-col gap-4">
      <Link to="/app/service" className="text-sm text-muted-foreground">← Back</Link>
      <Card>
        <CardHeader>
          <CardTitle>Edit service</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <ServiceForm
            key={s.id + s.name}
            initial={initial}
            submitLabel={update.isPending ? 'Saving…' : 'Save'}
            busy={update.isPending}
            onSubmit={(v) => update.mutate(v)}
          />
          {update.isSuccess && <p className="text-sm text-muted-foreground">Saved.</p>}
          <PublicLink serviceId={s.id} active={s.active} />
          <Button variant="destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>
            Delete service
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
