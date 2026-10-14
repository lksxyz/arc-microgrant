import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { useApi } from '@/lib/use-api'
import type { Business } from '@/lib/types'

export function PublicLink({ serviceId, active }: { serviceId: string; active: boolean }) {
  const call = useApi()
  const [copied, setCopied] = useState(false)
  const q = useQuery({
    queryKey: ['business'],
    queryFn: () => call<{ business: Business | null }>('/me/business'),
  })

  if (q.isPending) return null

  const slug = q.data?.business?.slug
  if (!slug) {
    return (
      <p className="text-xs text-muted-foreground">
        No booking link yet. Set it in <Link to="/app/setting" className="underline">Settings</Link>.
      </p>
    )
  }

  const path = `/b/${slug}/${serviceId}`
  const url = `${window.location.origin}${path}`

  const copy = async () => {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1 text-xs">{url}</code>
        <Button size="sm" variant="outline" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      {!active && <p className="text-xs text-muted-foreground">Service is inactive, the link can't be opened yet.</p>}
    </div>
  )
}
