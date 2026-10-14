import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usePrivy, useWallets } from '@privy-io/react-auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { useApi } from '@/lib/use-api'
import { type Business } from '@/lib/types'
import { useState, useEffect } from 'react'

export const Route = createFileRoute('/app/setting')({
  component: Setting,
})

function Setting() {
  const { user, logout } = usePrivy()
  const { wallets } = useWallets()
  const embeddedAddress = wallets.find((w) => w.walletClientType === 'privy')?.address ?? ''
  const call = useApi()
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['business'],
    queryFn: () => call<{ business: Business | null }>('/me/business'),
  })

  const [form, setForm] = useState<Business>({ name: '', tagline: '', description: '', slug: '', payoutAddress: '' })
  useEffect(() => {
    if (q.data?.business) setForm({ ...q.data.business, slug: q.data.business.slug ?? '', payoutAddress: q.data.business.payoutAddress || embeddedAddress })
  }, [q.data])

  const save = useMutation({
    mutationFn: () => call('/me/business', { method: 'PUT', body: { ...form, payoutAddress: form.payoutAddress || embeddedAddress } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['business'] }),
  })

  const account = user?.email?.address ?? user?.google?.email ?? user?.wallet?.address ?? user?.id

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Setting</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Business profile</CardTitle>
          <CardDescription>Shown to customers on WhatsApp.</CardDescription>
        </CardHeader>
        <CardContent>
          {q.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                save.mutate()
              }}
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="s-name">Business name</Label>
                <Input id="s-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="s-slug">Link booking</Label>
                <Input id="s-slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} />
                <p className="text-xs text-muted-foreground">/b/{form.slug || '…'}</p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="s-payout">Payout wallet (USDC)</Label>
                <Input
                  id="s-payout"
                  value={form.payoutAddress ?? ''}
                  onChange={(e) => setForm({ ...form, payoutAddress: e.target.value.trim() })}
                  placeholder="0x…"
                />
                <p className="text-xs text-muted-foreground">Customer deposits are sent to this address.</p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="s-tag">Tagline</Label>
                <Input id="s-tag" value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="s-desc">Description</Label>
                <Textarea id="s-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <Button type="submit" disabled={save.isPending}>Save</Button>
              {save.isSuccess && <p className="text-sm text-muted-foreground">Saved.</p>}
              {save.isError && <p className="text-sm text-destructive">Failed to save. The link may already be taken or invalid.</p>}
            </form>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account</CardTitle>
          <CardDescription className="break-all">{account}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => logout()}>Log out</Button>
        </CardContent>
      </Card>
    </div>
  )
}
