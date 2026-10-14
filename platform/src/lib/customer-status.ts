export const dateFmt = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Jakarta',
})

type Variant = 'default' | 'secondary' | 'destructive' | 'outline'

const LABELS: Record<string, { label: string; variant: Variant }> = {
  confirmed: { label: 'Terjadwal', variant: 'default' },
  no_show_claimed: { label: 'No-show claimed', variant: 'destructive' },
  merchant_cancelled: { label: 'Cancelled by merchant', variant: 'secondary' },
  cancelled_by_customer: { label: 'Cancelled', variant: 'outline' },
  disputed: { label: 'Dispute raised', variant: 'secondary' },
  refunded: { label: 'Refund completed', variant: 'outline' },
  pay_merchant: { label: 'Waiting for merchant claim', variant: 'secondary' },
  pay_customer: { label: 'Refund ready to claim', variant: 'default' },
  paid: { label: 'Completed', variant: 'outline' },
}

export const statusLabel = (status: string) => LABELS[status] ?? { label: status, variant: 'outline' as Variant }
