export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export type Business = {
  name: string
  tagline: string
  description: string
  slug: string
  payoutAddress?: string
}

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/

export const slugify = (v: string) =>
  v
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')

export type Availability = { days: number[]; start: string; end: string }

export type ServiceInput = {
  name: string
  description?: string
  durationMinutes: number
  priceUsdc: string
  depositUsdc: string
  claimDelayHours?: number
  availability: Availability
  active: boolean
}

export type Service = ServiceInput & { id: string }

export const emptyService = (): ServiceInput => ({
  name: '',
  description: '',
  durationMinutes: 60,
  priceUsdc: '',
  depositUsdc: '',
  claimDelayHours: 24,
  availability: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' },
  active: true,
})

export const isUsdcAmount = (v: string) => /^\d+(\.\d{1,6})?$/.test(v.trim())
