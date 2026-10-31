import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * A state, in the one green / amber / red the whole panel agrees on.
 *
 * ── WHY THE TONES ARE NAMED, NOT PICKED ─────────────────────────────────
 *
 * Every state here means one of four things to an operator: it WORKED, it is
 * WAITING on somebody, it FAILED, or it is simply not in play. The colours are
 * the theme's status tokens (`--success`, `--warning`, `--danger`), so an
 * approved withdrawal, a verified document and a settled bet are the same
 * green wherever they appear — and changing that green is one edit, not a
 * search across every screen that hardcoded `green-500/15`.
 *
 * A state nobody listed gets the neutral tone rather than a guess. Colour that
 * means nothing is worse than no colour: it teaches an operator to ignore it.
 */
const SUCCESS = [
  'active',
  'approved',
  'completed',
  'settled',
  'won',
  'verified',
  'published',
  'enabled',
  'paid',
  'credited',
  'live'
]

const WARNING = ['pending', 'processing', 'open', 'submitted', 'review', 'awaiting', 'partial']

const DANGER = [
  'suspended',
  'rejected',
  'cancelled',
  'failed',
  'lost',
  'locked',
  'closed',
  'disabled',
  'blocked',
  'expired'
]


/** In the system, but not in play — no colour, because nothing is happening. */
const NEUTRAL = ['void', 'inactive', 'draft', 'archived', 'unknown']

const TONES: Record<string, string> = {
  ...Object.fromEntries(SUCCESS.map(s => [s, 'bg-success-soft text-success'])),
  ...Object.fromEntries(WARNING.map(s => [s, 'bg-warning-soft text-warning'])),
  ...Object.fromEntries(DANGER.map(s => [s, 'bg-danger-soft text-danger'])),
  ...Object.fromEntries(NEUTRAL.map(s => [s, 'bg-muted text-muted-foreground']))
}

const StatusBadge = ({ value, className }: { value: string | boolean | null | undefined; className?: string }) => {
  if (value === null || value === undefined || value === '') return <span className='text-muted-foreground'>—</span>
  const text = typeof value === 'boolean' ? (value ? 'enabled' : 'disabled') : String(value)
  const tone = TONES[text.toLowerCase()] ?? 'bg-muted text-muted-foreground'

  return (
    <Badge
      variant='outline'
      className={cn('h-6 rounded-md border-transparent px-2 text-xs font-semibold capitalize', tone, className)}
    >
      {text.replace(/[_-]+/g, ' ')}
    </Badge>
  )
}

export default StatusBadge
