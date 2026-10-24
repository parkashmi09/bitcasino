'use client'

import { useState } from 'react'

import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { FormErrorsProvider, SwitchField, TextField, useFormErrors } from '@/components/shared/FormField'
import ErrorState from '@/components/shared/ErrorState'
import PageHeader from '@/components/shared/PageHeader'
import { RewardCurrencyNotice, useRewardCurrency } from '@/components/shared/RewardCurrency'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useSession } from '@/contexts/SessionContext'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { check } from '@/lib/validate'

type GameRates = { originals: string; slots: string; live: string; sports: string }

type Affiliate = {
  affiliateBonus: string
  registerBonus: string

  /** The referrer's joining bonus waits for the referee's first deposit (anti sign-up farming). */
  affiliateBonusRequiresDeposit: boolean

  /** hash.game: commission = wager × 1% × commissionRate% × gameRates[category]% (migration 134). */
  commissionRate: string
  gameRates: GameRates
}

const GAMES: { key: keyof GameRates; label: string }[] = [
  { key: 'originals', label: 'Originals' },
  { key: 'slots', label: '3rd party slots' },
  { key: 'live', label: 'Live casino' },
  { key: 'sports', label: 'Sports' }
]

const BLANK: Affiliate = {
  affiliateBonus: '',
  registerBonus: '',
  affiliateBonusRequiresDeposit: true,
  commissionRate: '',
  gameRates: { originals: '', slots: '', live: '', sports: '' }
}

/**
 * The editable form, keyed by the loaded settings: a fresh load remounts it
 * with the new values, so no effect copies server data into state.
 */
const AffiliateForm = ({ initial }: { initial: Affiliate | undefined }) => {
  const { can } = useSession()
  const { code: cur } = useRewardCurrency()
  const [form, setForm] = useState<Affiliate>(() => ({ ...BLANK, ...initial }))

  const f = useFormErrors()

  const patchOf = () => {
    const patch: Record<string, unknown> = {}

    for (const k of ['affiliateBonus', 'registerBonus', 'affiliateBonusRequiresDeposit', 'commissionRate'] as const)
      if (initial && form[k] !== initial[k]) patch[k] = typeof form[k] === 'string' ? (form[k] as string).trim() : form[k]

    const games: Partial<GameRates> = {}

    for (const { key } of GAMES) if (initial && form.gameRates[key] !== initial.gameRates?.[key]) games[key] = form.gameRates[key].trim()
    if (Object.keys(games).length) patch.gameRates = games

    return patch
  }

  const save = useApiMutation({
    fn: () => api.put<Affiliate>('admin/site-config/affiliate', patchOf()),
    invalidate: [['api', 'admin/site-config/affiliate']],
    success: 'Affiliate rates saved'
  })

  return (
    <form
      className='grid gap-4'
      onSubmit={e => {
        e.preventDefault()

        const rate = (v: string, label: string, max?: number) => check.number(v, label, { min: 0, max, decimals: 8 })

        const ok = f.passes({
          registerBonus: rate(form.registerBonus, 'Register bonus'),
          affiliateBonus: rate(form.affiliateBonus, 'Affiliate bonus'),
          commissionRate: rate(form.commissionRate, 'Commission rate', 100),
          ...Object.fromEntries(GAMES.map(g => [`rate-${g.key}`, rate(form.gameRates[g.key], `${g.label} rate`, 100)]))
        })

        if (!ok) return
        if (!Object.keys(patchOf()).length) return void toast.info('Nothing changed')
        save.mutate(undefined, { onError: f.fromServer })
      }}
    >
      <FormErrorsProvider errors={f.errors} onClear={f.clear}>
      <TextField id='registerBonus' inputMode='decimal' label={`Register bonus (${cur})`} hint='Credited to a new account on sign-up, only while switched on in Welcome bonuses' value={form.registerBonus} onChange={e => setForm({ ...form, registerBonus: e.target.value })} />
      <TextField
        id='affiliateBonus'
        label={`Affiliate bonus (${cur})`}
        hint={form.affiliateBonusRequiresDeposit ? 'Paid to the referrer once the referred user’s first deposit is credited' : 'Paid to the referrer per referred sign-up'}
        value={form.affiliateBonus}
        onChange={e => setForm({ ...form, affiliateBonus: e.target.value })}
      />
      <SwitchField
        id='affiliateBonusRequiresDeposit'
        label='Affiliate bonus only after the first deposit'
        hint='Stops fake sign-ups farming the bonus. Off: booked at sign-up.'
        checked={form.affiliateBonusRequiresDeposit}
        onChange={checked => setForm({ ...form, affiliateBonusRequiresDeposit: checked })}
        disabled={!can('config:write')}
      />
      <TextField
        id='commissionRate'
        inputMode='decimal'
        label='Commission rate %'
        hint='hash.game formula: wager × 1% × this rate × the game rate below. Default 25'
        value={form.commissionRate}
        onChange={e => setForm({ ...form, commissionRate: e.target.value })}
      />
      <div className='grid grid-cols-2 gap-3'>
        {GAMES.map(g => (
          <TextField
            key={g.key}
            id={`rate-${g.key}`}
            inputMode='decimal'
            label={`${g.label} game rate %`}
            value={form.gameRates[g.key]}
            onChange={e => setForm({ ...form, gameRates: { ...form.gameRates, [g.key]: e.target.value } })}
          />
        ))}
      </div>
      <p className='text-muted-foreground text-xs'>
        Example: ₹1,000 wagered on an original pays the referrer 1,000 × 1% × {form.commissionRate || 0}% × {form.gameRates.originals || 0}% ={' '}
        ₹{((1000 * 0.01 * Number(form.commissionRate || 0) * Number(form.gameRates.originals || 0)) / 10000).toFixed(2)}.
      </p>
      </FormErrorsProvider>
      <Button type='submit' disabled={save.isPending || !can('config:write')} className='justify-self-start'>
        {save.isPending && <Loader2Icon className='animate-spin' />}
        Save
      </Button>
    </form>
  )
}

/** One row of the player site's /referral/rules "Friend's Level / Total Wager / Unlock Amount" table. */
type UnlockTier = { level: string; totalWager: string; unlockAmount: string }
type ReferralUnlocks = { tiers: UnlockTier[]; currency: string; stored: boolean; configured: boolean; maxTiers?: number }

const UNLOCKS_PATH = 'admin/site-config/referral-unlocks'

/**
 * The VIP level names the player site prints (its ladder, Beginner … Eternal X),
 * offered as suggestions. A name the site's ladder knows gets its tier icon and
 * colour; any other name is printed as typed with the default icon.
 */
const VIP_LEVEL_NAMES = [
  'Beginner',
  ...['Bronze', 'Silver', 'Gold', 'Platinum'].flatMap(t => ['I', 'II', 'III', 'IV'].map(n => `${t} ${n}`)),
  ...['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'].map(n => `Diamond ${n}`),
  ...['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'].map(n => `Eternal ${n}`)
]

/** "1000.00000000" → "1000" for editing; the backend stores exact decimals either way. */
const trimDecimal = (v: string) => (v.includes('.') ? v.replace(/\.?0+$/, '') : v)

const sortUnlocks = (tiers: UnlockTier[]) => [...tiers].sort((a, b) => Number(a.totalWager) - Number(b.totalWager))

const isBlankUnlock = (t: UnlockTier) => !(t.level.trim() || t.totalWager.trim() || t.unlockAmount.trim())

/**
 * The referral unlock table (migration 106), keyed by the loaded settings like
 * the rates form. Saving sends the whole list, which replaces what is stored.
 */
const ReferralUnlocksForm = ({ saved }: { saved: ReferralUnlocks | undefined }) => {
  const { can } = useSession()
  const { code: cur } = useRewardCurrency()
  const writable = can('config:write')
  const max = saved?.maxTiers ?? 50

  const [tiers, setTiers] = useState<UnlockTier[]>(() =>
    (saved?.tiers ?? []).map(t => ({ level: t.level, totalWager: trimDecimal(t.totalWager), unlockAmount: trimDecimal(t.unlockAmount) }))
  )

  const f = useFormErrors()

  const setTier = (i: number, patch: Partial<UnlockTier>) => setTiers(ts => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)))

  /** The checks `updateReferralUnlockSettings` makes, keyed per row and field. */
  const validateForm = () => {
    const errors: Record<string, string | undefined> = {}
    const wagers = new Set<number>()
    const levels = new Set<string>()

    tiers.forEach((t, i) => {
      if (isBlankUnlock(t)) return
      const row = `Row ${i + 1}`
      const level = t.level.replace(/\s+/g, ' ').trim()

      const amount = (v: string, label: string) =>
        check.number(v, `${row}: ${label}`, { min: 0, decimals: 8 }) || (v.trim().split('.')[0].length > 12 ? `${row}: ${label} is too large` : undefined)

      errors[`unlock-${i}-level`] = !level ? `${row}: level is required` : level.length > 40 ? `${row}: level is at most 40 characters` : undefined
      errors[`unlock-${i}-totalWager`] = amount(t.totalWager, 'total wager')
      errors[`unlock-${i}-unlockAmount`] = amount(t.unlockAmount, 'unlock amount')

      const wager = Number(t.totalWager.trim() || 'NaN')

      if (!errors[`unlock-${i}-totalWager`] && wagers.has(wager)) errors[`unlock-${i}-totalWager`] = `${row}: two rows cannot have the same total wager`
      wagers.add(wager)

      if (!errors[`unlock-${i}-level`] && levels.has(level.toLowerCase())) errors[`unlock-${i}-level`] = `${row}: two rows cannot have the same level`
      levels.add(level.toLowerCase())
    })

    return errors
  }

  const payload = () =>
    sortUnlocks(tiers.filter(t => !isBlankUnlock(t))).map(t => ({
      level: t.level.replace(/\s+/g, ' ').trim(),
      totalWager: t.totalWager.trim(),
      unlockAmount: t.unlockAmount.trim()
    }))

  const save = useApiMutation({
    fn: () => api.put<ReferralUnlocks>(UNLOCKS_PATH, { tiers: payload() }),
    invalidate: [['api', UNLOCKS_PATH]],
    success: 'Referral unlock table saved'
  })

  const unchanged = () =>
    JSON.stringify(payload()) ===
    JSON.stringify((saved?.tiers ?? []).map(t => ({ level: t.level, totalWager: trimDecimal(t.totalWager), unlockAmount: trimDecimal(t.unlockAmount) })))

  const fieldError = (key: string) => (f.errors[key] ? <p className='text-destructive mt-1 text-xs'>{f.errors[key]}</p> : null)

  return (
    <form
      className='grid gap-4'
      onSubmit={e => {
        e.preventDefault()
        if (!f.passes(validateForm())) return
        if (unchanged()) return void toast.info('Nothing changed')
        setTiers(sortUnlocks(tiers.filter(t => !isBlankUnlock(t))))
        save.mutate(undefined, { onError: f.fromServer })
      }}
    >
      <FormErrorsProvider errors={f.errors} onClear={f.clear}>
        {saved && !saved.stored && saved.configured && (
          <p className='text-sm text-amber-600 dark:text-amber-400'>
            Showing the default table: the database has not been migrated for this setting yet, so saving will fail until
            the server runs its migrations.
          </p>
        )}
        <datalist id='referral-unlock-levels'>
          {VIP_LEVEL_NAMES.map(name => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Friend’s level</TableHead>
              <TableHead>Total wager ({cur})</TableHead>
              <TableHead>Unlock amount ({cur})</TableHead>
              <TableHead className='w-0' />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tiers.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className='text-muted-foreground'>
                  No rows. The page’s table will be empty.
                </TableCell>
              </TableRow>
            )}
            {tiers.map((t, i) => (
              <TableRow key={i}>
                <TableCell>
                  <Input
                    aria-label='Friend’s level'
                    list='referral-unlock-levels'
                    placeholder='Bronze I'
                    aria-invalid={f.errors[`unlock-${i}-level`] ? true : undefined}
                    value={t.level}
                    disabled={!writable}
                    onChange={e => {
                      f.clear(`unlock-${i}-level`)
                      setTier(i, { level: e.target.value })
                    }}
                  />
                  {fieldError(`unlock-${i}-level`)}
                </TableCell>
                <TableCell>
                  <Input
                    aria-label={`Total wager (${cur})`}
                    inputMode='decimal'
                    aria-invalid={f.errors[`unlock-${i}-totalWager`] ? true : undefined}
                    value={t.totalWager}
                    disabled={!writable}
                    onChange={e => {
                      f.clear(`unlock-${i}-totalWager`)
                      setTier(i, { totalWager: e.target.value })
                    }}
                  />
                  {fieldError(`unlock-${i}-totalWager`)}
                </TableCell>
                <TableCell>
                  <Input
                    aria-label={`Unlock amount (${cur})`}
                    inputMode='decimal'
                    aria-invalid={f.errors[`unlock-${i}-unlockAmount`] ? true : undefined}
                    value={t.unlockAmount}
                    disabled={!writable}
                    onChange={e => {
                      f.clear(`unlock-${i}-unlockAmount`)
                      setTier(i, { unlockAmount: e.target.value })
                    }}
                  />
                  {fieldError(`unlock-${i}-unlockAmount`)}
                </TableCell>
                <TableCell>
                  <Button type='button' variant='ghost' size='sm' onClick={() => setTiers(ts => ts.filter((_, j) => j !== i))} disabled={!writable}>
                    Remove
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {f.errors.tiers && <p className='text-destructive text-sm'>{f.errors.tiers}</p>}
        <p className='text-muted-foreground text-xs'>
          Rows are sorted by total wager when saved; two rows cannot share a level or a wager. A level name the player
          site’s VIP ladder knows (pick from the suggestions) gets its tier icon.
        </p>
        <div className='flex flex-wrap gap-2'>
          <Button
            type='button'
            variant='outline'
            disabled={!writable || tiers.length >= max}
            onClick={() => setTiers(ts => [...ts, { level: '', totalWager: '', unlockAmount: '' }])}
          >
            Add row
          </Button>
        </div>
      </FormErrorsProvider>
      <Button type='submit' disabled={save.isPending || !writable || !saved} className='justify-self-start'>
        {save.isPending && <Loader2Icon className='animate-spin' />}
        Save
      </Button>
    </form>
  )
}

/** `embedded`: inside the Affiliate page's Rates tab — no page header. */
const AffiliateSettings = ({ embedded = false }: { embedded?: boolean }) => {
  const q = useApi<Affiliate>('admin/site-config/affiliate')
  const unlocks = useApi<ReferralUnlocks>(UNLOCKS_PATH)

  return (
    <div>
      {!embedded && <PageHeader title='Affiliate rates' description='What the site promises a new user and a referrer. Public by intent — the sign-up page shows these.' />}
      {q.error && <ErrorState error={q.error} />}
      <RewardCurrencyNotice className='mb-4 max-w-xl' />
      <Card className='max-w-xl shadow-none'>
        <CardHeader>
          <CardTitle className='text-base'>Rates</CardTitle>
          <CardDescription>Exact decimal strings. Commission follows hash.game: wager × 1% × commission rate × game rate (Originals 28, Slots 60, Live 60, Sports 100).</CardDescription>
        </CardHeader>
        <CardContent>
          <AffiliateForm key={q.data ? JSON.stringify(q.data) : 'loading'} initial={q.data} />
        </CardContent>
      </Card>

      <Card className='mt-6 max-w-3xl shadow-none'>
        <CardHeader>
          <CardTitle className='text-base'>Friend level-up rewards</CardTitle>
          <CardDescription>
            The “Friend’s Level / Total Wager / Unlock Amount” table on the player site’s Referral › Rate &amp; Rules
            page: what a referrer unlocks as a referred friend’s wagering reaches each VIP level. Amounts are in{' '}
            {unlocks.data?.currency ?? 'the reward currency'}. This is the table players read; it does not change how
            user-service calculates tier payouts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {unlocks.error && <ErrorState error={unlocks.error} />}
          <ReferralUnlocksForm key={unlocks.data ? JSON.stringify(unlocks.data) : 'loading'} saved={unlocks.data} />
        </CardContent>
      </Card>
    </div>
  )
}

export default AffiliateSettings
