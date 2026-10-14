import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { isUsdcAmount, WEEKDAYS, type ServiceInput } from '@/lib/types'

export function ServiceForm({
  initial,
  submitLabel,
  onSubmit,
  busy,
}: {
  initial: ServiceInput
  submitLabel: string
  onSubmit: (v: ServiceInput) => void
  busy?: boolean
}) {
  const [v, setV] = useState(initial)
  const [error, setError] = useState<string | null>(null)

  const toggleDay = (d: number) =>
    setV((s) => ({
      ...s,
      availability: {
        ...s.availability,
        days: s.availability.days.includes(d)
          ? s.availability.days.filter((x) => x !== d)
          : [...s.availability.days, d].sort(),
      },
    }))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!v.name.trim()) return setError('Service name is required')
    if (!Number.isInteger(v.durationMinutes) || v.durationMinutes <= 0) return setError('Duration must be a number of minutes > 0')
    if (!isUsdcAmount(v.priceUsdc)) return setError('Invalid USDC price')
    if (!isUsdcAmount(v.depositUsdc)) return setError('Invalid USDC deposit')
    if (!Number.isInteger(v.claimDelayHours ?? 24) || (v.claimDelayHours ?? 24) < 0 || (v.claimDelayHours ?? 24) > 8760) return setError('Claim delay must be 0–8760 hours')
    if (v.availability.days.length === 0) return setError('Select at least 1 day')
    setError(null)
    onSubmit({ ...v, name: v.name.trim(), priceUsdc: v.priceUsdc.trim(), depositUsdc: v.depositUsdc.trim() })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="svc-name">Service name</Label>
        <Input id="svc-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Potong rambut" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="svc-desc">Description</Label>
        <Textarea id="svc-desc" value={v.description ?? ''} onChange={(e) => setV({ ...v, description: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="svc-duration">Duration (minutes)</Label>
          <Input id="svc-duration" type="number" min={1} value={v.durationMinutes} onChange={(e) => setV({ ...v, durationMinutes: Number(e.target.value) })} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="svc-price">Price (USDC)</Label>
          <Input id="svc-price" inputMode="decimal" value={v.priceUsdc} onChange={(e) => setV({ ...v, priceUsdc: e.target.value })} placeholder="10" />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="svc-deposit">Required deposit (USDC)</Label>
        <Input id="svc-deposit" inputMode="decimal" value={v.depositUsdc} onChange={(e) => setV({ ...v, depositUsdc: e.target.value })} placeholder="2" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="svc-claim">Merchant can claim after (hours)</Label>
        <Input id="svc-claim" type="number" min={0} max={8760} value={v.claimDelayHours ?? 24} onChange={(e) => setV({ ...v, claimDelayHours: Number(e.target.value) })} />
      </div>
      <div className="flex flex-col gap-2">
        <Label>Available days</Label>
        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((label, d) => {
            const on = v.availability.days.includes(d)
            return (
              <button
                key={label}
                type="button"
                onClick={() => toggleDay(d)}
                aria-pressed={on}
                className={`rounded-md border py-2 text-xs ${on ? 'bg-primary text-primary-foreground' : 'bg-background'}`}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="svc-start">Start time</Label>
          <Input id="svc-start" type="time" value={v.availability.start} onChange={(e) => setV({ ...v, availability: { ...v.availability, start: e.target.value } })} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="svc-end">End time</Label>
          <Input id="svc-end" type="time" value={v.availability.end} onChange={(e) => setV({ ...v, availability: { ...v.availability, end: e.target.value } })} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />
        Active (bookable)
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" size="lg" disabled={busy}>
        {submitLabel}
      </Button>
    </form>
  )
}
