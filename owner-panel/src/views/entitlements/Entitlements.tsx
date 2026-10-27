'use client'

import { useEffect, useRef, useState } from 'react'

import { CheckIcon, InfoIcon, Loader2Icon, PlusIcon, SearchIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'

import ErrorState from '@/components/shared/ErrorState'
import PageHeader from '@/components/shared/PageHeader'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DEFAULT_OFF_FLAGS,
  EXCLUSIVE_FLAGS,
  FEATURE_CATALOGUE,
  FEATURE_CATEGORIES,
  FLAG_GROUPS,
  featureByKey,
  featureLabel,
  flagLabel,
  optionsOf,
  REWARD_CURRENCIES
} from '@/configs/entitlementCatalogue'
import { HIDDEN_OPTIONS, pinToUi, UI_LABEL, uiSupport } from '@/configs/siteUi'
import { TEMPLATE_CATALOGUE, type TemplateEntry } from '@/configs/templateCatalogue'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api, ApiError } from '@/lib/api/client'
import { toastSaved, type SaveResult } from '@/lib/api/feedback'
import { buildDraft, isOwnerPick, type Draft } from '@/lib/entitlements/draft'
import {
  COUNTRY_CODES,
  LIST_TYPES,
  parseCountries,
  REGION_FEATURE,
  regionProblem,
  type RegionListType,
  type RegionSetting
} from '@/lib/entitlements/region'
import {
  DEFAULT_WITHDRAWAL_CAP,
  isMultiplier,
  MAX_MULTIPLIER,
  switchesOf,
  variantOfSwitches,
  WITHDRAWAL_REQUIREMENTS,
  type WithdrawalCap
} from '@/lib/entitlements/withdrawalCap'
import {
  DEFAULT_WITHDRAWAL_DAILY_LIMIT,
  isDailyLimit,
  MAX_DAILY_LIMIT,
  type WithdrawalDailyLimit
} from '@/lib/entitlements/withdrawalDailyLimit'
import {
  diffDocs,
  type Change,
  type EditableDoc,
  type EntitlementsDoc,
  type SiteMethod,
  type SiteMethods,
  type ToggleChange
} from '@/lib/entitlements/types'
import { isMethodCode, MAX_METHODS_PER_CURRENCY, type PaymentMethod } from '@/lib/entitlements/paymentMethods'
import { cn } from '@/lib/utils'
import ChangeList from './ChangeList'

type Kind = 'feature' | 'flag' | 'policy'

const FIAT_COIN_FLAGS = new Set(FLAG_GROUPS.find(g => g.title === 'Fiat currencies')?.keys ?? [])

type Row = { kind: Kind; key: string; label: string; description?: string; hint?: string; note?: string }
type Group = { id: string; title: string; description: string; rows: Row[]; bulk?: boolean }

type Tab = 'template' | 'withdrawals' | 'policies' | 'features' | 'flags'
type Section = { id: Exclude<Tab, 'template' | 'withdrawals'>; section: string; description?: string; groups: Group[] }

const GROUPS: Section[] = [
  {
    id: 'policies',
    section: 'Policies',
    description: 'How players join, move money and are rewarded. Always on; the option chosen is the policy.',
    groups: [
      {
        id: 'policy',
        title: 'Business, cashier and rewards',
        description: 'The site admin shows these read-only. Withdrawal requirements have their own tab.',
        bulk: false,
        rows: FEATURE_CATALOGUE.filter(f => f.policy && f.key !== WITHDRAWAL_REQUIREMENTS).map(f => ({
          kind: 'policy' as const,
          key: f.key,
          label: f.label,
          description: f.description,
          note: f.note
        }))
      }
    ]
  },
  {
    id: 'features',
    section: 'Features',
    description:
      'Each feature is ON or OFF for the site and runs one variant. The site admin shows them read-only; its staff can only key in integration settings.',
    groups: FEATURE_CATEGORIES.map(
      (cat): Group => ({
        id: `feature:${cat.key}`,
        title: cat.title,
        description: 'Off: hidden from players and refused by the backend.',
        rows: FEATURE_CATALOGUE.filter(
          f => f.category === cat.key && !f.policy && uiSupport(f.key)?.status !== 'absent'
        ).map(f => ({
          kind: 'feature' as const,
          key: f.key,
          label: f.label,
          description: f.description,
          hint: f.flag ? `flag ${f.flag}` : undefined
        }))
      })
    )
      .filter(g => g.rows.length > 0)
      .concat([
        {
          id: 'feature:absent',
          title: 'Not in this UI',
          description: 'This site has no screen for these, so they stay off and the backend refuses them.',
          bulk: false,
          rows: FEATURE_CATALOGUE.filter(f => !f.policy && uiSupport(f.key)?.status === 'absent').map(f => ({
            kind: 'feature' as const,
            key: f.key,
            label: f.label,
            description: (uiSupport(f.key) as { why: string }).why
          }))
        }
      ])
  },
  {
    id: 'flags',
    section: 'Site flags',

    // Game categories and the old per-studio Providers are not offered here (user's request, 2026-10-20; providers
    // are blocked per provider in the site admin); their keys stay in the document as they are.
    groups: FLAG_GROUPS.filter(g => g.title !== 'Game categories' && g.title !== 'Providers').map(g => ({
      id: `flag:${g.title}`,
      title: g.title,
      description: g.description,
      rows: g.keys.map(key => ({ kind: 'flag' as const, key, label: flagLabel(key) }))
    }))
  }
]

const WITHDRAWAL_ROW: Row = { kind: 'policy', key: WITHDRAWAL_REQUIREMENTS, label: 'Withdrawal requirements' }

const TABS: { id: Tab; label: string }[] = [
  { id: 'template', label: 'Template' },
  { id: 'withdrawals', label: 'Withdrawals' },
  { id: 'policies', label: 'Policies' },
  { id: 'features', label: 'Features' },
  { id: 'flags', label: 'Site flags' }
]

const POLICY_KEYS = new Set(FEATURE_CATALOGUE.filter(f => f.policy).map(f => f.key))

/** The tab an unsaved change belongs to, for the count on each tab. */
const tabOf = (c: Change): Tab => {
  if (c.kind === 'template') return 'template'
  if (c.kind === 'withdrawal_cap' || c.kind === 'withdrawal_daily_limit' || c.kind === 'withdrawals_enabled' || c.key === WITHDRAWAL_REQUIREMENTS) return 'withdrawals'
  if (c.kind === 'flag' || c.kind === 'payment_methods') return 'flags'
  if ((c.kind === 'variant' || c.kind === 'feature') && POLICY_KEYS.has(c.key)) return 'policies'

  return 'features'
}

/** A feature row's place in this client's UI (configs/siteUi.ts). */
const statusOf = (r: Row) => (r.kind === 'feature' ? (uiSupport(r.key)?.status ?? 'toggle') : null)

const labelOf = (c: ToggleChange) => (c.kind === 'feature' ? featureLabel(c.key) : flagLabel(c.key))

/** The variant a feature switched ON runs when its current one is `none`: the template's, else the first real one. */
const firstVariant = (feature: string, template?: string) => {
  const real = featureByKey(feature)?.variants.filter(v => v.key !== 'none') ?? []
  const fromTemplate = TEMPLATE_CATALOGUE.find(t => t.key === template)?.variants[feature]

  return real.find(v => v.key === fromTemplate)?.key ?? real[0]?.key ?? null
}

const VariantSelect = ({
  feature,
  value,
  onChange,
  label
}: {
  feature: string
  value: string
  onChange: (v: string) => void
  label: string
}) => {
  const variants = featureByKey(feature)?.variants ?? []

  return (
    <Select
      items={variants.map(v => ({ value: v.key, label: v.label }))}
      value={value}
      autoComplete='off'
      onValueChange={(v, details) => v && isOwnerPick(details.reason) && onChange(v)}
    >
      <SelectTrigger size='sm' className='w-full sm:w-60' aria-label={`${label} variant`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {variants.map(v => (
          <SelectItem key={v.key} value={v.key}>
            {v.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Clears an input's reported problem when it unmounts (filtered away, switched off): its typed text goes with it. */
const useClearOnUnmount = (onProblem: (problem: string | null) => void) => {
  const ref = useRef(onProblem)

  useEffect(() => {
    ref.current = onProblem
  })
  useEffect(() => () => ref.current(null), [])
}

/**
 * Region restriction's list type and countries, under its mode dropdown. Codes are typed as text
 * ("US, GB"); an unknown code is named here and refused by the save (422).
 */
const RegionEditor = ({
  value,
  onChange,
  changed,
  onProblem
}: {
  value: RegionSetting
  onChange: (r: RegionSetting) => void
  changed: boolean
  onProblem: (problem: string | null) => void
}) => {
  const [text, setText] = useState<string | null>(null)
  const shown = text ?? value.countries.join(', ')

  useClearOnUnmount(onProblem)
  const parsed = parseCountries(shown)
  const problem = regionProblem({ listType: value.listType, countries: parsed })

  return (
    <div
      className={cn('mt-2 flex flex-col gap-2 border-l pl-3', changed && 'bg-primary/5 -mx-1 rounded px-1')}
      data-region-editor
    >
      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-xs font-medium'>List type</span>
        <Select
          items={LIST_TYPES.map(l => ({ value: l.key, label: l.label }))}
          value={value.listType}
          autoComplete='off'
          onValueChange={(v, details) =>
            v && isOwnerPick(details.reason) && onChange({ ...value, listType: v as RegionListType })
          }
        >
          <SelectTrigger size='sm' className='w-40' aria-label='Region list type'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LIST_TYPES.map(l => (
              <SelectItem key={l.key} value={l.key}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className='text-muted-foreground text-xs'>
          {LIST_TYPES.find(l => l.key === value.listType)?.description}
        </span>
      </div>
      <label className='flex flex-col gap-1'>
        <span className='text-xs font-medium'>Countries (ISO 3166-1 alpha-2, comma separated)</span>
        <Input
          value={shown}
          placeholder='e.g. US, GB'
          aria-label='Region countries'
          aria-invalid={!!problem}
          onChange={e => {
            setText(e.target.value)
            const countries = parseCountries(e.target.value)

            onProblem(regionProblem({ listType: value.listType, countries }))
            if (countries.every(c => COUNTRY_CODES.includes(c)))
              onChange({ ...value, countries: [...countries].sort() })
          }}
          onBlur={() => !problem && setText(null)}
        />
      </label>
      {problem ? (
        <p className='text-destructive text-xs' data-warning='region-countries'>
          {problem}
        </p>
      ) : (
        <p className='text-muted-foreground text-xs'>
          {value.countries.length
            ? `${value.listType === 'allowlist' ? 'Only' : 'Restricted:'} ${value.countries.join(', ')}${value.listType === 'allowlist' ? ' allowed.' : '.'}`
            : 'No countries: nobody is restricted.'}{' '}
          Unknown and private addresses are never restricted.
        </p>
      )}
    </div>
  )
}

/** A multiplier typed by the owner: a positive number, at most 2 decimals, at most MAX_MULTIPLIER. */
const MultiplierInput = ({
  value,
  onChange,
  label,
  disabled,
  onProblem
}: {
  value: number
  onChange: (n: number) => void
  label: string
  disabled?: boolean
  onProblem: (problem: string | null) => void
}) => {
  const [text, setText] = useState<string | null>(null)
  const shown = text ?? String(value)

  useClearOnUnmount(onProblem)
  const parsed = /^\d+(\.\d{1,2})?$/.test(shown.trim()) ? Number(shown.trim()) : NaN
  const bad = !isMultiplier(parsed)

  return (
    <span className='inline-flex flex-col gap-0.5'>
      <span className='inline-flex items-center gap-1'>
        <Input
          value={shown}
          inputMode='decimal'
          disabled={disabled}
          aria-label={label}
          aria-invalid={bad}
          className='h-7 w-20'
          onChange={e => {
            setText(e.target.value)
            const t = e.target.value.trim()
            const n = /^\d+(\.\d{1,2})?$/.test(t) ? Number(t) : NaN

            onProblem(isMultiplier(n) ? null : `${label}: above 0, at most ${MAX_MULTIPLIER}, 2 decimals`)
            if (isMultiplier(n)) onChange(n)
          }}
          onBlur={() => !bad && setText(null)}
        />
        <span className='text-muted-foreground text-xs'>×</span>
      </span>
      {bad && !disabled && (
        <span className='text-destructive text-xs' data-warning='withdrawal-cap-multiplier'>
          Above 0, at most {MAX_MULTIPLIER}, 2 decimals
        </span>
      )}
    </span>
  )
}

/** One requirement switch with its label and what it means. */
const RequirementSwitch = ({
  label,
  description,
  checked,
  onChecked,
  name,
  disabled
}: {
  label: string
  description: string
  checked: boolean
  onChecked: (v: boolean) => void
  name: string
  disabled?: boolean
}) => (
  <label className='flex items-start gap-3' data-requirement={name}>
    <Switch size='sm' checked={checked} onCheckedChange={onChecked} disabled={disabled} aria-label={label} />
    <span className='min-w-0'>
      <span className='block text-xs font-medium'>{label}</span>
      <span className='text-muted-foreground block text-xs'>{description}</span>
    </span>
  </label>
)

type DailyRow = { id: number; code: string; text: string }

/**
 * The daily withdrawal limit's rows: a currency (the site's entitled coins) and an amount each.
 * Kept as local rows so a half-typed amount stays on screen; only valid rows reach the draft, and
 * any bad row blocks the save through `onProblem`.
 */
const DailyLimitEditor = ({
  value,
  coins,
  onChange,
  onProblem
}: {
  value: WithdrawalDailyLimit
  coins: { code: string; name: string }[]
  onChange: (d: WithdrawalDailyLimit) => void
  onProblem: (problem: string | null) => void
}) => {
  const [rows, setRows] = useState<DailyRow[]>(() => Object.entries(value.limits).map(([code, text], id) => ({ id, code, text })))
  const nextId = useRef(rows.length)

  useClearOnUnmount(onProblem)

  const rowProblem = (r: DailyRow) => (isDailyLimit(r.text) ? null : `${r.code}: an amount above 0, at most ${MAX_DAILY_LIMIT.toLocaleString('en-US')}, 8 decimals`)

  const apply = (next: DailyRow[]) => {
    setRows(next)
    const problem = next.map(rowProblem).find(Boolean) ?? (value.enabled && next.length === 0 ? 'Daily limit: add a currency, or switch it off' : null)

    onProblem(problem)
    onChange({ ...value, limits: Object.fromEntries(next.filter(r => !rowProblem(r)).map(r => [r.code, r.text.trim()])) })
  }

  const used = new Set(rows.map(r => r.code))
  const free = coins.filter(c => !used.has(c.code))

  return (
    <div className='flex flex-col gap-2' data-withdrawal-daily-rows>
      {rows.map(r => {
        const problem = r.text.trim() === '' ? null : rowProblem(r)
        const choices = coins.filter(c => c.code === r.code || !used.has(c.code))

        return (
          <div key={r.id} className='flex flex-col gap-0.5' data-daily-row={r.code}>
            <div className='flex flex-wrap items-center gap-2'>
              <Select
                items={choices.map(c => ({ value: c.code, label: c.code }))}
                value={r.code}
                autoComplete='off'
                onValueChange={(v, details) =>
                  v && isOwnerPick(details.reason) && apply(rows.map(x => (x.id === r.id ? { ...x, code: v } : x)))
                }
              >
                <SelectTrigger size='sm' className='w-28' aria-label='Currency'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {choices.map(c => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.code} <span className='text-muted-foreground text-xs'>{c.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={r.text}
                inputMode='decimal'
                placeholder='Amount per 24 h'
                aria-label={`${r.code} daily limit`}
                aria-invalid={Boolean(problem)}
                className='h-7 w-40'
                onChange={e => apply(rows.map(x => (x.id === r.id ? { ...x, text: e.target.value } : x)))}
              />
              <span className='text-muted-foreground text-xs'>{r.code} per 24 h</span>
              <Button
                type='button'
                variant='ghost'
                size='icon-sm'
                aria-label={`Remove ${r.code}`}
                onClick={() => apply(rows.filter(x => x.id !== r.id))}
              >
                <XIcon />
              </Button>
            </div>
            {problem && (
              <span className='text-destructive text-xs' data-warning='withdrawal-daily-limit'>
                Above 0, at most {MAX_DAILY_LIMIT.toLocaleString('en-US')}, 8 decimals
              </span>
            )}
          </div>
        )
      })}
      <div>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={!free.length}
          onClick={() => apply([...rows, { id: nextId.current++, code: free[0].code, text: '' }])}
        >
          <PlusIcon /> Add currency
        </Button>
      </div>
      {!rows.length && <p className='text-muted-foreground text-xs'>No currency yet: add one to set its limit.</p>}
    </div>
  )
}

/** An F2Pay currency row of Site flags (`f2pay_inr`) → its currency (`INR`); its methods are edited under it. */
const F2PAY_CURRENCY_ROW = /^f2pay_([a-z0-9]{2,10})$/

/**
 * One gateway currency's deposit methods: every method the site has (its seeded rows, the Super
 * Admin's, the owner's) plus the document's entries not on the site yet. The owner's Active switch
 * is the document entry's `active`, or on when there is none (missing = on); switching a site-only
 * method writes an entry, so the owner can switch off one the Super Admin added. Remove drops a
 * document entry only (the method goes back to "missing = on"). A bad or repeated code is refused inline.
 */
const MethodsEditor = ({
  currency,
  value,
  site,
  siteNote,
  changed,
  onChange
}: {
  currency: string
  value: PaymentMethod[]
  site: SiteMethod[]
  siteNote?: string
  changed: boolean
  onChange: (list: PaymentMethod[]) => void
}) => {
  const [code, setCode] = useState('')
  const typed = code.trim()
  const codes = [...new Set([...site.map(m => m.code), ...value.map(m => m.code)])]

  const problem = !typed
    ? null
    : !isMethodCode(typed)
      ? 'Letters, digits and _ only (e.g. QRIS, UpiMixed)'
      : codes.includes(typed)
        ? `${typed} is already listed`
        : value.length >= MAX_METHODS_PER_CURRENCY
          ? `At most ${MAX_METHODS_PER_CURRENCY} methods`
          : null

  const add = () => {
    if (!typed || problem) return
    onChange([...value, { code: typed, active: true }])
    setCode('')
  }

  const setActive = (c: string, active: boolean) =>
    onChange(value.some(m => m.code === c) ? value.map(m => (m.code === c ? { ...m, active } : m)) : [...value, { code: c, active }])

  return (
    <div className={cn('mt-2 flex flex-col gap-1.5 border-l pl-3', changed && 'bg-primary/5 -mx-1 rounded px-1')} data-methods={currency}>
      {codes.map(c => {
        const entry = value.find(m => m.code === c)
        const row = site.find(m => m.code === c)
        const active = entry?.active ?? true

        return (
          <div key={c} className='flex flex-wrap items-center gap-2' data-method={`${currency}:${c}`}>
            <Switch size='sm' checked={active} onCheckedChange={v => setActive(c, v)} aria-label={`${currency} ${c} active`} />
            <span className='font-mono text-xs'>{c}</span>
            <Badge variant='outline' className='font-normal'>
              {row ? row.addedBy : 'not on the site yet'}
            </Badge>
            <span className='text-muted-foreground text-xs'>{active ? 'active' : 'inactive'}</span>
            {row && !row.siteEnabled && <span className='text-destructive text-xs'>off by Super Admin</span>}
            {entry && (
              <Button
                type='button'
                variant='ghost'
                size='icon-sm'
                aria-label={`Remove ${currency} ${c}`}
                onClick={() => onChange(value.filter(m => m.code !== c))}
              >
                <XIcon />
              </Button>
            )}
          </div>
        )
      })}
      {!codes.length && <p className='text-muted-foreground text-xs'>No {currency} method yet: add one F2Pay offers.</p>}
      {siteNote && <p className='text-muted-foreground text-xs'>Site list unavailable: {siteNote}</p>}
      <div className='flex items-center gap-2'>
        <Input
          value={code}
          placeholder='Method code'
          aria-label={`New ${currency} method code`}
          aria-invalid={Boolean(problem)}
          className='h-7 w-40'
          onChange={e => setCode(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), add())}
        />
        <Button type='button' variant='outline' size='sm' disabled={!typed || Boolean(problem)} onClick={add}>
          <PlusIcon /> Add
        </Button>
      </div>
      {problem && (
        <span className='text-destructive text-xs' data-warning='payment-method-code'>
          {problem}
        </span>
      )}
    </div>
  )
}

/**
 * Withdrawal requirements as switches, any combination: KYC and wagering are the policy's variant
 * (none / kyc / wager / kyc_and_wager), the deposit cap is the document's `withdrawalCap`.
 */
const WithdrawalRequirementsEditor = ({
  variant,
  cap,
  daily,
  coins,
  onVariant,
  onCap,
  onDaily,
  changedVariant,
  changedCap,
  changedDaily,
  onProblem
}: {
  variant: string
  cap: WithdrawalCap
  daily: WithdrawalDailyLimit
  coins: { code: string; name: string }[]
  onVariant: (v: string) => void
  onCap: (c: WithdrawalCap) => void
  onDaily: (d: WithdrawalDailyLimit) => void
  changedVariant: boolean
  changedCap: boolean
  changedDaily: boolean
  onProblem: (key: string, problem: string | null) => void
}) => {
  const sw = switchesOf(variant)

  return (
    <div className='flex flex-col gap-4' data-withdrawal-requirements>
      <div className={cn('flex flex-col gap-3', changedVariant && 'bg-primary/5 -mx-1 rounded px-1')}>
        <RequirementSwitch
          name='kyc'
          label='KYC required'
          description="The player's KYC must be Verified."
          checked={sw.kyc}
          onChecked={v => onVariant(variantOfSwitches({ ...sw, kyc: v }))}
        />
        {/* The backend enforces the rollover under every variant, so this switch is fixed ON; the stored variant's wager half is left as is. */}
        <RequirementSwitch
          name='wager'
          label='Wagering complete required'
          description='Always on: the deposit rollover must be met before any withdrawal (since 21 Oct 2026, under every setting). Every active bonus must be wagered too; forfeiting a bonus clears its part.'
          checked
          disabled
          onChecked={() => {}}
        />
      </div>
      <div
        className={cn('flex flex-col gap-3 border-t pt-4', changedCap && 'bg-primary/5 -mx-1 rounded px-1')}
        data-withdrawal-cap
      >
        <RequirementSwitch
          name='cap'
          label='Withdrawal limit (deposit cap)'
          description='Per currency, a player can withdraw at most their deposits × the multiplier, plus the wagering bonus, minus what they have already withdrawn (pending included). Agent transfers count as INR deposits.'
          checked={cap.enabled}
          onChecked={v => onCap({ ...cap, enabled: v })}
        />
        {cap.enabled && (
          <div className='ml-12 flex flex-col gap-2'>
            <div className='flex flex-wrap items-center gap-2'>
              <span className='text-xs font-medium'>Deposit multiplier</span>
              <MultiplierInput
                label='Deposit multiplier'
                value={cap.depositMultiplier}
                onChange={n => onCap({ ...cap, depositMultiplier: n })}
                onProblem={p => onProblem('depositMultiplier', p)}
              />
            </div>
            <label className='flex items-center gap-2'>
              <Switch
                size='sm'
                checked={cap.wagerBonus}
                onCheckedChange={v => {
                  // Off: its multiplier is not used, so a half-typed one no longer blocks the save.
                  if (!v) onProblem('wagerMultiplier', null)
                  onCap({ ...cap, wagerBonus: v })
                }}
                aria-label='Wagering bonus'
              />
              <span className='text-xs font-medium'>Wagering bonus</span>
              <span className='text-muted-foreground text-xs'>adds the amount wagered, up to</span>
              <MultiplierInput
                label='Wager bonus multiplier'
                value={cap.wagerMultiplier}
                disabled={!cap.wagerBonus}
                onChange={n => onCap({ ...cap, wagerMultiplier: n })}
                onProblem={p => onProblem('wagerMultiplier', cap.wagerBonus ? p : null)}
              />
              <span className='text-muted-foreground text-xs'>deposits</span>
            </label>
            <p className='text-muted-foreground text-xs'>
              Wagering bonus: extra room earned by playing. Every rupee bet (casino and settled sports bets, refunds
              excluded) adds a rupee to the limit, until the bonus reaches the multiplier × deposits.
            </p>
            <p className='text-muted-foreground text-xs'>
              Example: 1,000 deposited, 1,000 wagered → cap{' '}
              {(
                1000 * cap.depositMultiplier +
                (cap.wagerBonus ? Math.min(1000, 1000 * cap.wagerMultiplier) : 0)
              ).toLocaleString('en-US')}
              . Refused over it: 403 WITHDRAW_CAP_EXCEEDED.
            </p>
          </div>
        )}
      </div>
      <div
        className={cn('flex flex-col gap-3 border-t pt-4', changedDaily && 'bg-primary/5 -mx-1 rounded px-1')}
        data-withdrawal-daily-limit
      >
        <RequirementSwitch
          name='daily'
          label='Daily withdrawal limit (per currency)'
          description='Pick a currency and an amount: a player can withdraw at most that much of it in any rolling 24 hours, pending withdrawals included, on every rail (bank, crypto, gateway payouts, P2P sell). A currency with no row has no daily limit.'
          checked={daily.enabled}
          onChecked={v => {
            // Off: its rows are not used, so a half-typed amount no longer blocks the save.
            if (!v) onProblem('dailyLimit', null)

            // On with no currency yet: nothing to save until a row is added.
            else if (!Object.keys(daily.limits).length) onProblem('dailyLimit', 'Daily limit: add a currency, or switch it off')
            onDaily({ ...daily, enabled: v })
          }}
        />
        {daily.enabled && (
          <div className='ml-12 flex flex-col gap-2'>
            <DailyLimitEditor value={daily} coins={coins} onChange={onDaily} onProblem={p => onProblem('dailyLimit', p)} />
            <p className='text-muted-foreground text-xs'>
              Counted in the currency itself, never converted. Refused over it: 403 WITHDRAW_DAILY_LIMIT (&quot;Daily
              withdrawal limit is 50,000 INR; 12,000 INR left today.&quot;).
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

const TemplateCard = ({
  template,
  selected,
  saved,
  onSelect
}: {
  template: TemplateEntry
  selected: boolean
  saved: boolean
  onSelect: () => void
}) => (
  <button
    type='button'
    aria-pressed={selected}
    onClick={onSelect}
    className={cn(
      'bg-card flex flex-col gap-3 rounded-xl border p-4 text-left transition-colors',
      selected ? 'border-primary ring-primary/30 ring-2' : 'hover:border-foreground/30'
    )}
  >
    {/* Preview swatch only: accent on background. The site's real tokens live in its theme. */}
    <div
      className='flex h-14 items-end gap-2 rounded-md border p-2'
      style={{ backgroundColor: template.swatch.background }}
      aria-hidden
    >
      <span className='h-6 w-10 rounded-sm' style={{ backgroundColor: template.swatch.accent }} />
      <span className='h-2 w-16 rounded-full opacity-60' style={{ backgroundColor: template.swatch.accent }} />
    </div>
    <div className='flex items-center justify-between gap-2'>
      <span className='font-semibold'>{template.label}</span>
      {selected ? (
        <Badge className='gap-1'>
          <CheckIcon className='size-3' /> {saved ? 'Active' : 'Selected'}
        </Badge>
      ) : saved ? (
        <Badge variant='outline'>Current</Badge>
      ) : (
        <span className='text-muted-foreground font-mono text-xs'>{template.key}</span>
      )}
    </div>
    <p className='text-xs'>
      <span className='font-medium'>Player site:</span> {template.colours}
    </p>
  </button>
)

const Entitlements = () => {
  const { data: doc, error, isLoading, refetch, isRefetching } = useApi<EditableDoc & { siteMethods?: SiteMethods }>('/api/owner/entitlements')

  // The site's payment methods (seeded, the Super Admin's, the owner's) come with the document, shown with the document's.
  const siteMethods = doc?.siteMethods

  // Edits on top of the loaded document; null = nothing touched yet.
  const [edits, setEdits] = useState<Draft | null>(null)
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<Tab>('template')
  const [reviewing, setReviewing] = useState(false)

  // Inputs whose text is not a valid value yet (the draft keeps the last valid one): they block the save.
  const [invalid, setInvalid] = useState<Record<string, string>>({})

  // Bumped on discard / save so the typed-text inputs drop what they held.
  const [epoch, setEpoch] = useState(0)

  const report = (key: string, problem: string | null) =>
    setInvalid(prev => {
      if ((prev[key] ?? null) === problem) return prev
      const next = { ...prev }

      if (problem) next[key] = problem
      else delete next[key]

      return next
    })

  const invalidProblem = Object.values(invalid)[0] ?? null

  const reset = () => {
    setEdits(null)
    setInvalid({})
    setEpoch(e => e + 1)
  }

  // Pinned to this UI the way the save pins it (store.ts), so the screen shows what will be stored.
  const draft: Draft | null = doc ? (d => ({ ...d, ...pinToUi(d.features, d.variants) }))(buildDraft(doc, edits)) : null

  const changes = doc && draft ? diffDocs(doc, draft) : []
  const changed = new Set(changes.map(c => `${c.kind === 'variant' ? 'feature' : c.kind}:${c.key}`))
  const changesIn = (t: Tab) => changes.filter(c => tabOf(c) === t).length

  const edit = (fn: (next: Draft) => void) =>
    setEdits(prev => {
      const next: Draft = {
        template: prev?.template,
        features: { ...prev?.features },
        flags: { ...prev?.flags },
        variants: { ...prev?.variants },
        options: Object.fromEntries(Object.entries(prev?.options ?? {}).map(([f, v]) => [f, { ...v }])),
        ...(prev?.region ? { region: { ...prev.region, countries: [...prev.region.countries] } } : {}),
        ...(prev?.withdrawalCap ? { withdrawalCap: { ...prev.withdrawalCap } } : {}),
        ...(prev?.withdrawalDailyLimit
          ? { withdrawalDailyLimit: { ...prev.withdrawalDailyLimit, limits: { ...prev.withdrawalDailyLimit.limits } } }
          : {}),
        ...(prev?.paymentMethods ? { paymentMethods: prev.paymentMethods } : {}),
        ...(prev?.withdrawalsEnabled !== undefined ? { withdrawalsEnabled: prev.withdrawalsEnabled } : {})
      }

      fn(next)

      return next
    })

  /** ON/OFF. A feature switched on while its variant is `none` gets a real one (contract: `none` = off). */
  const set = (rows: Row[], value: boolean) =>
    edit(next => {
      for (const r of rows) {
        if (r.kind === 'policy') continue

        if (r.kind === 'flag') {
          // "Allow all" never switches the sportsbook on: it would replace the exchange.
          if (value && rows.length > 1 && DEFAULT_OFF_FLAGS.has(r.key)) continue
          next.flags[r.key] = value
          if (value && EXCLUSIVE_FLAGS[r.key]) next.flags[EXCLUSIVE_FLAGS[r.key]] = false
          continue
        }

        const current = next.variants[r.key] ?? doc?.variants[r.key]
        const variant = value && (!current || current === 'none') ? firstVariant(r.key, draft?.template) : current

        // A feature with no real variant (nothing implements it yet) cannot be switched on.
        if (value && !variant) continue
        next.features[r.key] = value
        if (variant && variant !== current) next.variants[r.key] = variant
      }
    })

  /** One F2Pay currency's methods; an emptied currency (or gateway) leaves the document. */
  const setMethods = (currency: string, list: PaymentMethod[]) =>
    edit(next => {
      const all = next.paymentMethods ?? draft?.paymentMethods ?? {}
      const f2pay = { ...all.f2pay, [currency]: list }

      if (!list.length) delete f2pay[currency]
      next.paymentMethods = { ...all, f2pay }
      if (!Object.keys(f2pay).length) delete next.paymentMethods.f2pay
    })

  /** An owner-only option of a feature (e.g. when the spin wheel grants a spin). */
  const setOption = (feature: string, option: string, value: boolean) =>
    edit(next => {
      next.options[feature] = { ...next.options[feature], [option]: value }
    })

  /** Picking `none` switches the feature off; any other variant switches it on. Policies are always on. */
  const setVariant = (r: Row, variant: string) =>
    edit(next => {
      next.variants[r.key] = variant
      if (r.kind === 'feature') next.features[r.key] = variant !== 'none'
    })

  /** On this client a template is a colour theme only: it never switches a feature or a variant. */
  const pickTemplate = (key: string) =>
    edit(next => {
      next.template = key === doc?.template ? undefined : key
    })

  const save = useApiMutation<void, SaveResult & { doc: EntitlementsDoc; changes: Change[] }>({
    fn: () =>
      api.put('/api/owner/entitlements', {
        version: doc!.version,
        template: draft!.template,
        features: draft!.features,
        flags: draft!.flags,
        variants: draft!.variants,
        options: draft!.options,
        region: draft!.region,
        withdrawalCap: draft!.withdrawalCap,
        withdrawalDailyLimit: draft!.withdrawalDailyLimit,
        paymentMethods: draft!.paymentMethods,
        withdrawalsEnabled: draft!.withdrawalsEnabled
      }),
    invalidate: [['api']],
    errorTitle: 'Features & plan not saved',
    onSuccess: r => {
      toastSaved(r)
      reset()
      setReviewing(false)
    }
  })

  const q = query.trim().toLowerCase()

  const match = (r: Row) =>
    !q ||
    r.key.toLowerCase().includes(q) ||
    r.label.toLowerCase().includes(q) ||
    (r.description ?? '').toLowerCase().includes(q) ||
    (r.kind !== 'flag' &&
      (featureByKey(r.key)?.variants ?? []).some(v => v.key.includes(q) || v.label.toLowerCase().includes(q)))

  const renderSection = ({ id, section, description, groups }: Section) => {
    const visible = groups.map(g => ({ ...g, shown: g.rows.filter(match) })).filter(g => g.shown.length > 0)

    if (!visible.length) return null

    return (
      <section key={id} className='flex flex-col gap-4'>
        <div>
          <h2 className='text-lg font-semibold'>{section}</h2>
          {description && <p className='text-muted-foreground text-sm'>{description}</p>}
        </div>
        <div className='grid items-start gap-4 lg:grid-cols-2'>
          {visible.map(g => {
            const value = (r: Row) =>
              r.kind === 'policy' || (r.kind === 'feature' ? draft!.features : draft!.flags)[r.key] !== false

            const switchable = (r: Row) => statusOf(r) === null || statusOf(r) === 'toggle'

            // The reward currency's coin must itself be entitled (its coin flag; a crypto coin also the crypto master).
            const coinBlocked = (code: string) => {
              const k = code.toLowerCase()

              return draft!.flags[k] === false || (!FIAT_COIN_FLAGS.has(k) && draft!.flags.cryptocoin === false)
            }

            const on = g.rows.filter(value).length

            return (
              <Card key={g.id} className='gap-4 shadow-none'>
                <CardHeader>
                  <CardTitle className='flex items-center gap-2'>
                    {g.title}
                    <Badge variant='outline' className='font-normal tabular-nums'>
                      {on}/{g.rows.length}
                    </Badge>
                  </CardTitle>
                  <CardDescription>{g.description}</CardDescription>
                  {g.bulk !== false && (
                    <CardAction className='flex gap-1'>
                      <Button size='xs' variant='outline' onClick={() => set(g.shown.filter(switchable), true)}>
                        {g.shown[0]?.kind === 'flag' ? 'Allow all' : 'All on'}
                      </Button>
                      <Button size='xs' variant='outline' onClick={() => set(g.shown.filter(switchable), false)}>
                        {g.shown[0]?.kind === 'flag' ? 'Block all' : 'All off'}
                      </Button>
                    </CardAction>
                  )}
                </CardHeader>
                <CardContent className='flex flex-col divide-y'>
                  {g.shown.map(r => {
                    const variant = r.kind === 'flag' ? null : draft!.variants[r.key]
                    const variantInfo = variant ? featureByKey(r.key)?.variants.find(v => v.key === variant) : undefined
                    const canTurnOn = r.kind !== 'feature' || value(r) || !!firstVariant(r.key, draft!.template)
                    const status = statusOf(r)
                    const rowKey = `${r.kind === 'policy' ? 'feature' : r.kind}:${r.key}`
                    const methodsCurrency = r.kind === 'flag' ? F2PAY_CURRENCY_ROW.exec(r.key)?.[1].toUpperCase() : undefined

                    return (
                      <div
                        key={r.key}
                        data-row={r.key}
                        className={cn(
                          'flex flex-col gap-2 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4',
                          (changed.has(rowKey) || changed.has(`variant:${r.key}`)) && 'bg-primary/5 -mx-2 rounded px-2'
                        )}
                      >
                        <div className='min-w-0'>
                          <div className='flex flex-wrap items-center gap-2'>
                            <span className='text-sm font-medium'>{r.label}</span>
                            <span className='text-muted-foreground font-mono text-xs'>{r.key}</span>
                            {r.hint && <span className='text-muted-foreground text-xs'>· {r.hint}</span>}
                          </div>
                          <p className='text-muted-foreground mt-0.5 text-xs'>
                            {r.kind === 'flag' || status === 'absent'
                              ? r.description
                              : status
                                ? `${UI_LABEL}: ${(uiSupport(r.key) as { surfaces: string }).surfaces}.`
                                : (r.note ?? variantInfo?.description ?? r.description)}
                          </p>
                          {r.kind === 'feature' &&
                            status !== 'absent' &&
                            optionsOf(r.key).some(o => !HIDDEN_OPTIONS.has(`${r.key}.${o.key}`)) && (
                              <div className='mt-2 flex flex-col gap-2 border-l pl-3' data-options={r.key}>
                                {optionsOf(r.key)
                                  .filter(o => !HIDDEN_OPTIONS.has(`${r.key}.${o.key}`))
                                  .map(o => (
                                    <label
                                      key={o.key}
                                      data-option={`${r.key}.${o.key}`}
                                      className={cn(
                                        'flex items-start gap-3',
                                        changed.has(`option:${r.key}.${o.key}`) && 'bg-primary/5 -mx-1 rounded px-1'
                                      )}
                                    >
                                      <Switch
                                        size='sm'
                                        checked={draft!.options[r.key]?.[o.key] ?? o.default}
                                        onCheckedChange={v => setOption(r.key, o.key, v)}
                                        aria-label={o.label}
                                      />
                                      <span className='min-w-0'>
                                        <span className='block text-xs font-medium'>{o.label}</span>
                                        <span className='text-muted-foreground block text-xs'>{o.description}</span>
                                      </span>
                                    </label>
                                  ))}
                              </div>
                            )}
                          {r.key === REGION_FEATURE && (
                            <RegionEditor
                              key={`region-${epoch}`}
                              onProblem={p => report('region', p)}
                              value={draft!.region ?? { listType: 'blocklist', countries: [] }}
                              changed={changed.has('region:region')}
                              onChange={region => edit(next => void (next.region = region))}
                            />
                          )}
                          {methodsCurrency && (
                            <MethodsEditor
                              key={`methods-${methodsCurrency}-${epoch}`}
                              currency={methodsCurrency}
                              value={draft!.paymentMethods?.f2pay?.[methodsCurrency] ?? []}
                              site={(siteMethods?.methods ?? []).filter(m => m.gateway === 'f2pay' && m.currency === methodsCurrency)}
                              siteNote={siteMethods?.source === 'unavailable' ? siteMethods.reason : undefined}
                              changed={changed.has('payment_methods:paymentMethods')}
                              onChange={list => setMethods(methodsCurrency, list)}
                            />
                          )}
                          {r.key === 'default_currency' && variant && coinBlocked(variant) && (
                            <p className='text-destructive mt-0.5 text-xs' data-warning='default-currency-coin-off'>
                              {variant} is not entitled under Site flags, so screens cannot open on it. Allow the coin
                              or pick another default coin.
                            </p>
                          )}
                          {r.key === 'reward_currency' && variant && coinBlocked(variant) && (
                            <p className='text-destructive mt-0.5 text-xs' data-warning='reward-currency-coin-off'>
                              {variant} is not entitled under Site flags, so players cannot see that balance. Allow the
                              coin or pick another reward currency.
                            </p>
                          )}
                        </div>
                        <div className='flex shrink-0 items-center gap-3'>
                          {r.kind === 'policy' && variant && (
                            <VariantSelect
                              feature={r.key}
                              value={variant}
                              label={r.label}
                              onChange={v => setVariant(r, v)}
                            />
                          )}
                          {status === 'toggle' && (
                            <Badge variant='outline' className='font-normal'>
                              {UI_LABEL}
                            </Badge>
                          )}
                          {status === 'fixed' && (
                            <Badge variant='secondary' className='font-normal'>
                              Always on in this UI
                            </Badge>
                          )}
                          {status === 'absent' && (
                            <Badge variant='outline' className='text-muted-foreground font-normal'>
                              Not in this UI
                            </Badge>
                          )}
                          {r.kind !== 'policy' && (
                            <Switch
                              checked={value(r)}
                              disabled={!canTurnOn || !switchable(r)}
                              onCheckedChange={v => set([r], v)}
                              aria-label={r.kind === 'flag' ? `${r.label} entitled` : `${r.label} on`}
                            />
                          )}
                        </div>
                      </div>
                    )
                  })}
                </CardContent>
              </Card>
            )
          })}
        </div>
      </section>
    )
  }

  const withdrawalVariant = draft?.variants[WITHDRAWAL_REQUIREMENTS]

  // The daily limit's currency choices: the wallet coins entitled under Site flags (a crypto coin
  // also needs the crypto master), plus any already set so a row never loses its currency.
  const dailyCoins = REWARD_CURRENCIES.filter(c => {
    const k = c.code.toLowerCase()
    const entitled = draft?.flags[k] !== false && (FIAT_COIN_FLAGS.has(k) || draft?.flags.cryptocoin !== false)

    return entitled || c.code in (draft?.withdrawalDailyLimit?.limits ?? {})
  })


  return (
    <div className={cn(changes.length > 0 && 'pb-20')}>
      <PageHeader
        title='Features & plan'
        description={
          doc
            ? `Version ${doc.version}. The template, the policies and every feature's ON/OFF and variant are set here only; the site admin shows them read-only.`
            : 'Loading…'
        }
        actions={
          <div className='relative'>
            <SearchIcon className='text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2' />
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder='Search key or label'
              className='w-64 pl-8'
            />
          </div>
        }
      />
      {error ? (
        <ErrorState
          error={error}
          title='Could not load the entitlements document'
          onRetry={refetch}
          retrying={isRefetching}
        />
      ) : isLoading || !draft ? (
        <div className='grid gap-4 lg:grid-cols-2'>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className='h-56' />
          ))}
        </div>
      ) : (
        <div className='flex flex-col gap-8'>
          {doc?.seededFrom && (
            <Alert>
              <InfoIcon />
              <AlertTitle>No variants saved yet</AlertTitle>
              <AlertDescription>
                {doc.seededFrom === 'backend'
                  ? "The variants and ON/OFF below were read from the site's live state."
                  : 'The site did not answer, so the variants below come from the current template.'}{' '}
                The next save records them all in the document.
              </AlertDescription>
            </Alert>
          )}
          {q ? (
            <>
              {q && !GROUPS.some(({ groups }) => groups.some(g => g.rows.some(match))) && (
                <p
                  className='text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm'
                  data-empty='search'
                >
                  Nothing matches “{query.trim()}”. Search by a feature or flag key, its label, or a variant.
                </p>
              )}
              {GROUPS.map(renderSection)}
            </>
          ) : (
            <Tabs value={tab} onValueChange={v => setTab(v as Tab)}>
              <TabsList className='h-auto flex-wrap'>
                {TABS.map(t => (
                  <TabsTrigger key={t.id} value={t.id} className='px-3'>
                    {t.label}
                    {changesIn(t.id) > 0 && (
                      <Badge className='h-4 min-w-4 px-1 text-[0.65rem] tabular-nums' data-tab-changes={t.id}>
                        {changesIn(t.id)}
                      </Badge>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value='template' className='mt-4'>
                <section className='flex flex-col gap-4'>
                  <div>
                    <h2 className='text-lg font-semibold'>Template</h2>
                    <p className='text-muted-foreground text-sm'>
                      The site&apos;s colour theme. This site runs the {UI_LABEL}: a template recolours it (layout,
                      fonts and art stay) and never changes a feature below. Original keeps the site&apos;s
                      own colours. The site admin follows it unless Policies → Admin colour theme picks its own.
                    </p>
                  </div>
                  <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
                    {TEMPLATE_CATALOGUE.map(t => (
                      <TemplateCard
                        key={t.key}
                        template={t}
                        selected={draft.template === t.key}
                        saved={doc?.template === t.key}
                        onSelect={() => pickTemplate(t.key)}
                      />
                    ))}
                  </div>
                </section>
              </TabsContent>
              <TabsContent value='withdrawals' className='mt-4'>
                <section className='flex flex-col gap-4' data-tab='withdrawals'>
                  <div>
                    <h2 className='text-lg font-semibold'>Withdrawals</h2>
                    <p className='text-muted-foreground text-sm'>
                      What a player must meet before a withdrawal goes through, and how much they can take out. Set here
                      only: the site admin shows the limit and the wagering bonus read-only.
                    </p>
                  </div>
                  <Card className='max-w-3xl gap-4 shadow-none'>
                    <CardHeader>
                      <CardTitle>Withdrawal requirements</CardTitle>
                      <CardDescription>
                        Any combination of the switches. Saved with the rest of Features &amp; plan (Review and save,
                        below).
                      </CardDescription>
                    </CardHeader>
                    <CardContent className='flex flex-col gap-4'>
                      <div
                        className={cn(
                          'border-b pb-4',
                          changed.has('withdrawals_enabled:withdrawalsEnabled') && 'bg-primary/5 -mx-1 rounded px-1'
                        )}
                        data-withdrawals-enabled
                      >
                        <RequirementSwitch
                          name='enabled'
                          label='Withdrawals enabled'
                          description='Off stops every player withdrawal on every rail (bank, crypto, gateway payouts, P2P sell). Refused while off: 403 WITHDRAW_DISABLED.'
                          checked={draft.withdrawalsEnabled !== false}
                          onChecked={v => edit(next => void (next.withdrawalsEnabled = v))}
                        />
                      </div>
                      {withdrawalVariant ? (
                        <WithdrawalRequirementsEditor
                          key={`withdrawal-${epoch}`}
                          onProblem={report}
                          variant={withdrawalVariant}
                          cap={draft.withdrawalCap ?? DEFAULT_WITHDRAWAL_CAP}
                          changedVariant={changed.has(`feature:${WITHDRAWAL_REQUIREMENTS}`)}
                          changedCap={changed.has('withdrawal_cap:withdrawalCap')}
                          daily={draft.withdrawalDailyLimit ?? DEFAULT_WITHDRAWAL_DAILY_LIMIT}
                          coins={dailyCoins}
                          changedDaily={changed.has('withdrawal_daily_limit:withdrawalDailyLimit')}
                          onVariant={v => setVariant(WITHDRAWAL_ROW, v)}
                          onCap={withdrawalCap => edit(next => void (next.withdrawalCap = withdrawalCap))}
                          onDaily={withdrawalDailyLimit => edit(next => void (next.withdrawalDailyLimit = withdrawalDailyLimit))}
                        />
                      ) : (
                        <p className='text-muted-foreground text-sm'>
                          The site has not reported its withdrawal requirements yet.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </section>
              </TabsContent>
              {GROUPS.map(sec => (
                <TabsContent key={sec.id} value={sec.id} className='mt-4'>
                  {renderSection(sec)}
                </TabsContent>
              ))}
            </Tabs>
          )}
        </div>
      )}

      {(changes.length > 0 || invalidProblem) && (
        <div className='bg-card fixed inset-x-0 bottom-0 z-40 border-t shadow-lg'>
          <div className='mx-auto flex max-w-360 items-center justify-between gap-4 px-4 py-3 sm:px-6'>
            {invalidProblem ? (
              <p className='text-destructive text-sm' role='alert' data-save-blocked>
                Fix before saving: {invalidProblem}
              </p>
            ) : (
              <p className='text-sm'>
                <span className='font-semibold'>{changes.length}</span> unsaved change{changes.length === 1 ? '' : 's'}
              </p>
            )}
            <div className='flex gap-2'>
              <Button
                variant='outline'
                onClick={() => {
                  reset()
                  toast.info('Changes discarded')
                }}
                disabled={save.isPending}
              >
                Discard
              </Button>
              <Button
                disabled={!!invalidProblem}
                onClick={() =>
                  changes.length
                    ? setReviewing(true)
                    : toast.info('Nothing to save', { description: 'No change from the stored version.' })
                }
              >
                Review and save
              </Button>
            </div>
          </div>
        </div>
      )}

      <Dialog open={reviewing} onOpenChange={setReviewing}>
        <DialogContent className='sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>Save features &amp; plan</DialogTitle>
            <DialogDescription>
              Version {doc?.version} → {(doc?.version ?? 0) + 1}. The site picks this up within seconds.
            </DialogDescription>
          </DialogHeader>
          <div className='max-h-[60vh] overflow-y-auto'>
            <ChangeList changes={changes} labelOf={labelOf} />
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setReviewing(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <Button
              disabled={save.isPending || !!invalidProblem}
              onClick={() =>
                save.mutate(undefined, {
                  onError: e => {
                    if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') {
                      toast.info('Reloaded the latest version; your edits are kept on top of it.')
                      void refetch()
                    }
                  }
                })
              }
            >
              {save.isPending && <Loader2Icon className='animate-spin' />} Save {changes.length} change
              {changes.length === 1 ? '' : 's'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default Entitlements
