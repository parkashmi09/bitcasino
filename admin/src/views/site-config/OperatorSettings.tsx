'use client'

import { useState } from 'react'

import { Loader2Icon } from 'lucide-react'

import { toast } from 'sonner'

import ErrorState from '@/components/shared/ErrorState'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useSession } from '@/contexts/SessionContext'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { check, cleanErrors, firstError } from '@/lib/validate'

/**
 * Limits, policy and schedule — the values that used to be environment
 * variables.
 *
 * ── WHY THEY ARE HERE ───────────────────────────────────────────────────
 *
 * The minimum bet, the maximum payout, the timezone a race week resets in:
 * these are the operator's decisions, and while they lived in `.env` changing
 * one meant a deploy by whoever held shell access. They are stored per site
 * now, set here, and every write is permissioned and audited.
 *
 * WHAT IS NOT SET HERE stays in `.env` on purpose: credentials, ports, service
 * URLs, CORS, worker intervals. Those say where the software runs, which is a
 * deployment's business, not an operator's.
 *
 * A row with nothing stored runs on the default; saving sets it, and `Reset to
 * default` hands it back.
 */

type Setting = {
  key: string
  label: string
  kind: 'number' | 'decimal' | 'boolean' | 'timezone' | 'text'
  env: string
  envValue: string | null
  stored: string | number | boolean | null
  value: string | number | boolean | null
  source: 'operator' | 'environment'
  min?: number
  max?: number
  maxLength?: number
}

const GROUPS: { title: string; hint: string; keys: string[] }[] = [
  {
    title: 'Races',
    hint: 'When the weekly race leaderboard resets.',
    keys: ['race_timezone']
  },
  {
    title: 'User accounts',
    hint: 'How a sign-in locks, how many sessions a user keeps, whether a player with no bet is signed out 5 minutes after sign-in, and whether an email must be verified before money moves.',
    keys: ['login_max_attempts', 'login_lock_minutes', 'max_active_sessions', 'idle_logout', 'require_email_verification']
  },
  {
    title: 'Bonus',
    hint: 'Whether a granted bonus stays locked until it is wagered (only while the owner panel has the lock on too), whether a player may give a locked bonus up to withdraw, and the popup the player confirms that in.',
    keys: ['bonus_wagering_lock', 'bonus_contribution_all', 'bonus_forfeit_allowed', 'bonus_forfeit_title', 'bonus_forfeit_message']
  },
  {
    title: 'Loss bonus',
    hint: "Lossback (Welcome Shield): a share of a player's net loss (casino + sports, bets minus wins) in the hours after their first deposit — or, with Welcome Shield off, over every completed period. Settled automatically when the window ends; the player claims it on the Bonus page after a confirmation, within the claim hours. Amounts are in the site's reward currency.",
    keys: [
      'loss_bonus_enabled',
      'loss_bonus_welcome',
      'loss_bonus_protection_hours',
      'loss_bonus_period_days',
      'loss_bonus_percent',
      'loss_bonus_max',
      'loss_bonus_min_loss',
      'loss_bonus_max_bet',
      'loss_bonus_claim_hours',
      'loss_bonus_wager_multiplier'
    ]
  }
]

/** A setting that is the Super Admin's only while the owner has its flag on (owner panel → Player sessions). */
const OWNER_FLAG: Record<string, string> = { idle_logout: 'idle_logout' }

const OperatorSettings = () => {
  const { can, flagEntitled } = useSession()
  const canWrite = can('config:write')
  const q = useApi<Setting[]>('admin/site-config/settings')
  const [draft, setDraft] = useState<Record<string, string | boolean | null>>({})

  const [errors, setErrors] = useState<Record<string, string>>({})

  const save = useApiMutation({
    fn: () => api.put<Setting[]>('admin/site-config/settings', draft),
    invalidate: [['api', 'admin/site-config/settings']],
    success: 'Saved — the services pick it up on their next read',
    onSuccess: () => {
      setDraft({})
      setErrors({})
    }
  })

  const header = (
    <PageHeader
      title='Limits and policy'
      description='The numbers this site runs on.'
    />
  )

  // The heading stays on an error, like every other screen, so the page still says what it is.
  if (q.error)
    return (
      <div>
        {header}
        <ErrorState error={q.error} />
      </div>
    )

  const rows = q.data ?? []
  const byKey = Object.fromEntries(rows.map(r => [r.key, r]))
  const dirty = Object.keys(draft)

  /** The value a key will have after the save (the draft, else what is in force). */
  const effective = (key: string) => (key in draft ? draft[key] : byKey[key]?.value)

  /** Each changed value against its kind and the bounds the platform reports, then min ≤ max pairs. */
  const validateDraft = () => {
    const found: Record<string, string | undefined> = {}

    for (const key of dirty) {
      const s = byKey[key]
      const v = draft[key]

      if (!s || v === null || s.kind === 'boolean') continue

      if (s.kind === 'timezone') {
        try {
          new Intl.DateTimeFormat('en', { timeZone: String(v).trim() })
          if (!String(v).trim()) found[key] = `${s.label} is required`
        } catch {
          found[key] = `${s.label} must be an IANA timezone, e.g. Asia/Kolkata`
        }

        continue
      }

      if (s.kind === 'text') {
        const text = String(v).trim()

        if (!text) found[key] = `${s.label} is required — use Reset to default instead`
        else if (s.maxLength && text.length > s.maxLength) found[key] = `${s.label} must be ${s.maxLength} characters or fewer`
        else if (/[<>]/.test(text)) found[key] = `${s.label} cannot contain < or >`

        continue
      }

      found[key] = check.number(String(v), s.label, { min: s.min ?? 0, max: s.max, integer: s.kind === 'number' })
    }

    const pairs: [string, string][] = []

    for (const [lo, hi] of pairs) {
      if (!(lo in draft) && !(hi in draft)) continue
      const a = Number(effective(lo))
      const b = Number(effective(hi))

      if (byKey[lo] && byKey[hi] && effective(lo) !== null && effective(hi) !== null && Number.isFinite(a) && Number.isFinite(b) && a > b) {
        const key = hi in draft ? hi : lo

        found[key] = found[key] ?? `${byKey[lo].label} cannot be more than ${byKey[hi].label}`
      }
    }

    return cleanErrors(found)
  }

  const submit = () => {
    const found = validateDraft()

    setErrors(found)

    if (Object.keys(found).length) {
      toast.error(firstError(found))

      return
    }

    save.mutate()
  }

  const field = (s: Setting) => {
    const pending = s.key in draft
    const current = pending ? draft[s.key] : s.value

    if (s.kind === 'boolean') {
      return (
        <Switch
          checked={current === true || current === 'true'}
          disabled={!canWrite}
          onCheckedChange={v => setDraft(d => ({ ...d, [s.key]: v }))}
        />
      )
    }

    if (s.kind === 'text') {
      const Field = (s.maxLength ?? 0) > 100 ? Textarea : Input

      return (
        <span className='grid gap-1'>
          <Field
            className='w-80 text-sm'
            value={current === null || current === undefined ? '' : String(current)}
            maxLength={s.maxLength}
            disabled={!canWrite}
            aria-invalid={errors[s.key] ? true : undefined}
            onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
              const value = e.target.value

              setDraft(d => ({ ...d, [s.key]: value }))
              setErrors(prev => {
                const next = { ...prev }

                delete next[s.key]

                return next
              })
            }}
          />
          {errors[s.key] && <span className='text-destructive w-80 text-xs'>{errors[s.key]}</span>}
        </span>
      )
    }

    return (
      <span className='grid gap-1'>
        <Input
          className='h-8 w-44 font-mono text-xs'
          value={current === null || current === undefined ? '' : String(current)}
          placeholder={s.envValue ?? 'not set'}
          disabled={!canWrite}
          inputMode={s.kind === 'timezone' ? undefined : 'decimal'}
          aria-invalid={errors[s.key] ? true : undefined}
          onChange={e => {
            const value = e.target.value

            setDraft(d => ({ ...d, [s.key]: value }))
            setErrors(prev => {
              const next = { ...prev }

              delete next[s.key]

              return next
            })
          }}
        />
        {errors[s.key] && <span className='text-destructive w-44 text-xs'>{errors[s.key]}</span>}
        {!errors[s.key] && (s.min !== undefined || s.max !== undefined) && (
          <span className='text-muted-foreground text-[11px]'>
            {s.min ?? 0} – {s.max ?? '∞'}
          </span>
        )}
      </span>
    )
  }

  return (
    <div>
      {header}

      {dirty.length > 0 && (
        <div className='mb-4 flex items-center gap-2'>
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending && <Loader2Icon className='animate-spin' />}
            Save {dirty.length} change{dirty.length > 1 ? 's' : ''}
          </Button>
          <Button
            variant='outline'
            disabled={save.isPending}
            onClick={() => {
              setDraft({})
              setErrors({})
            }}
          >
            Discard
          </Button>
        </div>
      )}

      <div className='grid gap-4'>
        {GROUPS.map(group => (
          <Card key={group.title} className='shadow-none'>
            <CardHeader>
              <CardTitle className='text-base'>{group.title}</CardTitle>
              <CardDescription>{group.hint}</CardDescription>
            </CardHeader>
            <CardContent className='grid gap-3'>
              {group.keys.map(key => {
                const s = byKey[key]

                if (!s || !flagEntitled(OWNER_FLAG[key])) return null

                return (
                  <div key={key} className='flex flex-wrap items-center justify-between gap-3 border-b pb-3 last:border-0 last:pb-0'>
                    <div className='min-w-56'>
                      <span className='block text-sm font-medium'>{s.label}</span>
                    </div>
                    <div className='flex items-center gap-2'>
                      {field(s)}
                      {s.source === 'operator' && canWrite && (
                        <Button size='sm' variant='ghost' onClick={() => setDraft(d => ({ ...d, [s.key]: null }))} title='Back to the default value'>
                          Reset to default
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

export default OperatorSettings
