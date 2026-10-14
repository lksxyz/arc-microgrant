import { useState } from 'react'
import { txUrl } from '@/lib/chain'

const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`

export function TxLink({ hash, label }: { hash: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const url = txUrl(hash)

  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="font-mono underline underline-offset-2">
          {short(hash)} ↗
        </a>
      ) : (
        <button
          type="button"
          className="font-mono underline underline-offset-2"
          onClick={async () => {
            await navigator.clipboard.writeText(hash)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
          title={hash}
        >
          {copied ? 'Copied' : short(hash)}
        </button>
      )}
    </div>
  )
}
