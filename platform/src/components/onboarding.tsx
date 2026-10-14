import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useWallets } from '@privy-io/react-auth'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useApi } from '@/lib/use-api'
import { SKIP_ONBOARDING_KEY } from '@/lib/store'
import { emptyService, slugify, SLUG_PATTERN, type Business, type ServiceInput } from '@/lib/types'
import { ServiceForm } from './service-form'

export function Onboarding() {
  const call = useApi()
  const qc = useQueryClient()
  const { wallets } = useWallets()
  const embeddedAddress = wallets.find((w) => w.walletClientType === 'privy')?.address ?? ''
  const navigate = useNavigate()
  const [step, setStep] = useState<1 | 2>(1)
  const [biz, setBiz] = useState<Business>({ name: '', tagline: '', description: '', slug: '' })
  const [bizError, setBizError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: async (service: ServiceInput) => {
      await call('/me/business', { method: 'PUT', body: { ...biz, payoutAddress: biz.payoutAddress || embeddedAddress } })
      await call('/me/services', { method: 'POST', body: service })
    },
    onSuccess: async () => {
      await qc.invalidateQueries()
      navigate({ to: '/app' })
    },
  })

  const skip = () => {
    localStorage.setItem(SKIP_ONBOARDING_KEY, '1')
    navigate({ to: '/app' })
  }

  const nextStep = (e: React.FormEvent) => {
    e.preventDefault()
    if (!biz.name.trim() || !biz.tagline.trim()) return setBizError('Business name and tagline are required')
    const slug = (biz.slug || slugify(biz.name)).trim()
    if (!SLUG_PATTERN.test(slug)) return setBizError('Slug: 3–40 lowercase letters, numbers, or hyphens')
    setBizError(null)
    setBiz({ ...biz, name: biz.name.trim(), tagline: biz.tagline.trim(), description: biz.description.trim(), slug })
    setStep(2)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Welcome to Intensio</CardTitle>
        <CardDescription>Step {step} of 2. You can fill this in later under Settings.</CardDescription>
      </CardHeader>
      <CardContent>
        {step === 1 ? (
          <form onSubmit={nextStep} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="biz-name">Business name</Label>
              <Input
                id="biz-name"
                value={biz.name}
                onChange={(e) => setBiz({ ...biz, name: e.target.value, slug: biz.slug || slugify(e.target.value) })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="biz-slug">Link booking</Label>
              <Input
                id="biz-slug"
                value={biz.slug}
                onChange={(e) => setBiz({ ...biz, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                placeholder="kopi-budi"
              />
              <p className="text-xs text-muted-foreground">/b/{biz.slug || 'nama-bisnis'}</p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="biz-tagline">Tagline</Label>
              <Input id="biz-tagline" value={biz.tagline} onChange={(e) => setBiz({ ...biz, tagline: e.target.value })} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="biz-desc">Description</Label>
              <Textarea id="biz-desc" value={biz.description} onChange={(e) => setBiz({ ...biz, description: e.target.value })} />
            </div>
            {bizError && <p className="text-sm text-destructive">{bizError}</p>}
            <Button type="submit" size="lg">Next</Button>
            <Button type="button" variant="ghost" onClick={skip}>Skip for now</Button>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <ServiceForm
              initial={emptyService()}
              submitLabel="Save & start"
              busy={save.isPending}
              onSubmit={(s) => save.mutate(s)}
            />
            {save.isError && <p className="text-sm text-destructive">Failed to save, please try again.</p>}
            <Button type="button" variant="ghost" onClick={skip}>Skip</Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
