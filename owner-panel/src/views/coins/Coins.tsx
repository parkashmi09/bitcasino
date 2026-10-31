'use client'

import { useState } from 'react'

import { CoinsIcon, InfoIcon, Loader2Icon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'

import ErrorState from '@/components/shared/ErrorState'
import PageHeader from '@/components/shared/PageHeader'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { flagLabel } from '@/configs/entitlementCatalogue'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api, ApiError } from '@/lib/api/client'
import { toastSaved, type SaveResult } from '@/lib/api/feedback'
import { COIN_CODE, COIN_KINDS, MAX_DECIMALS, USD_RATE, cleanCoin, coinProblem, diffCoins, isBuiltinCoin } from '@/lib/entitlements/coins'
import { diffDocs, type Change, type CoinDefinition, type EditableDoc, type EntitlementsDoc, type SiteCoin, type ToggleChange } from '@/lib/entitlements/types'
import { cn } from '@/lib/utils'
import ChangeList from '../entitlements/ChangeList'

/** The crypto master flag: off = no crypto coin is in the plan, whatever each coin's own switch says. */
const MASTER = 'cryptocoin'

const flagOf = (code: string) => code.toLowerCase()

/** A built-in coin's network in the plan: `flags["usdt:bep20"]`, missing = on (the site reads the same key). */
const networkFlagOf = (code: string, key: string) => `${code}:${key}`.toLowerCase()

const CoinImage = ({ coin }: { coin: SiteCoin }) =>
  coin.imageUrl ? (
     
    <img src={coin.imageUrl} alt='' className='size-8 rounded-full object-contain' />
  ) : (
    <div className='bg-muted text-muted-foreground flex size-8 items-center justify-center rounded-full font-mono text-[10px] font-semibold'>{coin.code.slice(0, 3)}</div>
  )

type CoinForm = { code: string; name: string; symbol: string; kind: CoinDefinition['kind']; decimals: string; usdRate: string; networks: { key: string; name: string }[]; enabled: boolean }

const KIND_LABEL: Record<CoinDefinition['kind'], string> = { crypto: 'Crypto', fiat: 'Fiat', points: 'Points' }

const emptyForm = (): CoinForm => ({ code: '', name: '', symbol: '', kind: 'points', decimals: '2', usdRate: '', networks: [], enabled: true })

const formOf = (c: CoinDefinition): CoinForm => ({
  code: c.code,
  name: c.name,
  symbol: c.symbol ?? '',
  kind: c.kind,
  decimals: String(c.decimals ?? 8),
  usdRate: c.usdRate ?? '',
  networks: (c.networks ?? []).map(n => ({ ...n })),
  enabled: c.enabled !== false
})

const definitionOf = (f: CoinForm): CoinDefinition => ({
  code: f.code.trim().toUpperCase(),
  kind: f.kind,
  name: f.name,
  symbol: f.symbol,
  decimals: /^\d+$/.test(f.decimals.trim()) ? Number(f.decimals.trim()) : Number.NaN,
  usdRate: f.usdRate.trim(),
  networks: f.kind === 'crypto' ? f.networks.map(n => ({ key: n.key.trim(), name: n.name.trim() })) : [],
  enabled: f.enabled
})

type FormErrors = Partial<Record<'code' | 'name' | 'symbol' | 'decimals' | 'usdRate' | 'networks', string>>

const UNSAFE_TEXT = /[<>\u0000-\u001f\u007f]/
const NETWORK_KEY = /^[A-Za-z0-9_-]{1,20}$/

/** Each field's problem, the rules of `coinProblem` (which the save route runs) split per field. */
function formErrors(f: CoinForm, editing: boolean, taken: (code: string) => boolean): FormErrors {
  const out: FormErrors = {}
  const code = f.code.trim().toUpperCase()

  if (!editing) {
    if (!code) out.code = 'Required'
    else if (!COIN_CODE.test(code)) out.code = 'A capital letter, then 1–9 capitals or digits (e.g. QAC)'
    else if (isBuiltinCoin(code)) out.code = `${code} is a built-in coin — switch it in the table instead`
    else if (taken(code)) out.code = `${code} already exists on this site`
  }

  if (!f.name.trim()) out.name = 'Required'
  else if (f.name.trim().length > 60) out.name = 'At most 60 characters'
  else if (UNSAFE_TEXT.test(f.name)) out.name = 'No < > or control characters'

  if (f.symbol.trim().length > 12) out.symbol = 'At most 12 characters'
  else if (UNSAFE_TEXT.test(f.symbol)) out.symbol = 'No < > or control characters'

  const d = f.decimals.trim()

  if (!d) out.decimals = 'Required'
  else if (!/^\d+$/.test(d) || Number(d) > MAX_DECIMALS) out.decimals = `A whole number from 0 to ${MAX_DECIMALS}`

  const rate = f.usdRate.trim()

  if (!rate) out.usdRate = 'Required'
  else if (!USD_RATE.test(rate)) out.usdRate = 'A number like 0.01 — at most 8 decimal places'
  else if (!(Number(rate) > 0)) out.usdRate = 'Must be above 0'

  if (f.kind === 'crypto') {
    const keys = new Set<string>()

    for (const [i, n] of f.networks.entries()) {
      const key = n.key.trim()

      if (!NETWORK_KEY.test(key)) out.networks = `Network ${i + 1}: the key is 1–20 letters, digits, - or _`
      else if (!n.name.trim() || n.name.trim().length > 40 || UNSAFE_TEXT.test(n.name)) out.networks = `Network ${key}: needs a name (at most 40 characters, no < >)`
      else if (keys.has(key)) out.networks = `Network ${key} is listed twice`
      if (out.networks) break
      keys.add(key)
    }
  }

  return out
}

const FieldError = ({ id, message }: { id: string; message?: string }) =>
  message ? (
    <p id={id} className='text-destructive text-xs' role='alert' data-error={id}>
      {message}
    </p>
  ) : null

/**
 * Add or edit one custom coin. The code is fixed once created (balances are keyed by it); the
 * coin is never deleted — the switch turns it off. Applying only stages the change: it is saved
 * with the rest through Review and save.
 */
const CoinDialog = ({
  open,
  editing,
  initial,
  taken,
  onClose,
  onApply
}: {
  open: boolean
  editing: boolean
  initial: CoinForm
  taken: (code: string) => boolean
  onClose: () => void
  onApply: (c: CoinDefinition) => void
}) => {
  const [form, setForm] = useState<CoinForm>(initial)
  const [error, setError] = useState<string | null>(null)

  // Errors show once Apply was pressed, then follow the typing.
  const [tried, setTried] = useState(false)
  const set = <K extends keyof CoinForm>(key: K, value: CoinForm[K]) => setForm(prev => ({ ...prev, [key]: value }))
  const errors = formErrors(form, editing, taken)
  const shown: FormErrors = tried ? errors : {}
  const errorCount = Object.keys(errors).length

  const apply = () => {
    setTried(true)
    if (errorCount) return
    const def = definitionOf(form)
    const problem = coinProblem(def)

    if (problem) return setError(problem)
    const clean = cleanCoin(def)

    if (editing && JSON.stringify(clean) === JSON.stringify(cleanCoin(definitionOf(initial)))) {
      toast.info('No changes to apply')
      onClose()

      return
    }

    onApply(clean)
    toast.success(editing ? `${clean.code} changes staged` : `${clean.code} added to the list`, { description: 'Review and save to put it live.' })
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${form.code}` : 'Add a coin'}</DialogTitle>
          <DialogDescription>
            A site coin: balances, staff adjustments, swap (at the USD rate) and Vault Pro. No deposits, withdrawals, games or sports — it has no provider.
          </DialogDescription>
        </DialogHeader>
        <form
          className='flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1'
          onSubmit={e => {
            e.preventDefault()
            apply()
          }}
        >
          <div className='grid grid-cols-2 gap-3'>
            <Field>
              <FieldLabel htmlFor='coin-code'>Code</FieldLabel>
              <Input
                id='coin-code'
                name='code'
                value={form.code}
                disabled={editing}
                maxLength={10}
                autoComplete='off'
                placeholder='QAC'
                className='font-mono uppercase'
                aria-invalid={!!shown.code}
                onChange={e => set('code', e.target.value.toUpperCase())}
              />
              <FieldError id='coin-code-error' message={shown.code} />
              <FieldDescription>{editing ? 'Fixed once created.' : 'A capital letter, then 1–9 capitals or digits.'}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor='coin-kind'>Kind</FieldLabel>
              <Select items={COIN_KINDS.map(k => ({ value: k, label: KIND_LABEL[k] }))} value={form.kind} onValueChange={v => v && set('kind', v as CoinDefinition['kind'])}>
                <SelectTrigger id='coin-kind' className='w-full' aria-label='Kind'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COIN_KINDS.map(k => (
                    <SelectItem key={k} value={k}>
                      {KIND_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor='coin-name'>Name</FieldLabel>
              <Input id='coin-name' name='name' value={form.name} maxLength={60} placeholder='QA coin' aria-invalid={!!shown.name} onChange={e => set('name', e.target.value)} />
              <FieldError id='coin-name-error' message={shown.name} />
            </Field>
            <Field>
              <FieldLabel htmlFor='coin-symbol'>Symbol</FieldLabel>
              <Input
                id='coin-symbol'
                name='symbol'
                value={form.symbol}
                maxLength={12}
                placeholder={form.code || 'QAC'}
                aria-invalid={!!shown.symbol}
                onChange={e => set('symbol', e.target.value)}
              />
              <FieldError id='coin-symbol-error' message={shown.symbol} />
            </Field>
            <Field>
              <FieldLabel htmlFor='coin-decimals'>Decimals</FieldLabel>
              <Input id='coin-decimals' name='decimals' inputMode='numeric' value={form.decimals} aria-invalid={!!shown.decimals} onChange={e => set('decimals', e.target.value)} />
              <FieldError id='coin-decimals-error' message={shown.decimals} />
              <FieldDescription>0–{MAX_DECIMALS}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor='coin-rate'>USD rate</FieldLabel>
              <Input id='coin-rate' name='usdRate' inputMode='decimal' value={form.usdRate} placeholder='0.01' aria-invalid={!!shown.usdRate} onChange={e => set('usdRate', e.target.value)} />
              <FieldError id='coin-rate-error' message={shown.usdRate} />
              <FieldDescription>USD value of 1 {form.code || 'unit'}; swap prices it here.</FieldDescription>
            </Field>
          </div>

          {form.kind === 'crypto' && (
            <Field>
              <FieldLabel>Networks</FieldLabel>
              <div className='flex flex-col gap-2'>
                {form.networks.map((n, i) => (
                  <div key={i} className='flex items-center gap-2'>
                    <Input
                      aria-label={`Network ${i + 1} key`}
                      value={n.key}
                      maxLength={20}
                      placeholder='TRC20'
                      className='font-mono'
                      onChange={e => set('networks', form.networks.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
                    />
                    <Input
                      aria-label={`Network ${i + 1} name`}
                      value={n.name}
                      maxLength={40}
                      placeholder='Tron'
                      onChange={e => set('networks', form.networks.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                    />
                    <Button type='button' variant='ghost' size='icon' aria-label={`Remove network ${i + 1}`} onClick={() => set('networks', form.networks.filter((_, j) => j !== i))}>
                      <Trash2Icon />
                    </Button>
                  </div>
                ))}
                <Button type='button' variant='outline' size='sm' className='w-fit' disabled={form.networks.length >= 20} onClick={() => set('networks', [...form.networks, { key: '', name: '' }])}>
                  <PlusIcon /> Add network
                </Button>
              </div>
              <FieldError id='coin-networks-error' message={shown.networks} />
              <FieldDescription>Labels only for now: a custom coin has no deposit or withdrawal rail.</FieldDescription>
            </Field>
          )}

          <Field orientation='horizontal'>
            <Switch id='coin-enabled' checked={form.enabled} onCheckedChange={v => set('enabled', v)} />
            <FieldLabel htmlFor='coin-enabled'>{form.enabled ? 'On — in the plan' : 'Off — hidden from players'}</FieldLabel>
          </Field>

          {tried && errorCount > 0 ? (
            <p role='alert' className='text-destructive text-sm'>
              Fix {errorCount} field{errorCount === 1 ? '' : 's'} above first.
            </p>
          ) : (
            error && (
              <p role='alert' className='text-destructive text-sm'>
                {error}
              </p>
            )
          )}
          <button type='submit' className='hidden' aria-hidden tabIndex={-1} />
        </form>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={apply} disabled={tried && errorCount > 0}>
            {editing ? 'Apply changes' : 'Add coin'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The owner's coins: which of the site's coins are in the plan. Each switch is the coin's flag in
 * the entitlement document (`flags.btc`, …) — the same flag the Features & plan screen lists —
 * and the crypto master `flags.cryptocoin`. The site's own switch, names, images and network
 * names are the site admin's; they are shown here read-only, as the site reports them.
 */
const Coins = () => {
  const { data: doc, error, isLoading, refetch, isRefetching } = useApi<EditableDoc>('/api/owner/entitlements')
  const site = useApi<{ coins: SiteCoin[]; source: 'site' | 'catalogue'; reason?: string }>('/api/owner/coins')
  const [edits, setEdits] = useState<Record<string, boolean>>({})
  const [coinDraft, setCoinDraft] = useState<CoinDefinition[] | null>(null)
  const [dialog, setDialog] = useState<{ editing: boolean; form: CoinForm; key: number } | null>(null)
  const [reviewing, setReviewing] = useState(false)

  const flags = doc ? { ...doc.flags, ...edits } : {}
  const savedCoins = doc?.coins ?? []
  const ownerCoins = coinDraft ?? savedCoins

  const changes: Change[] = doc
    ? [...diffDocs({ features: doc.features, flags: doc.flags }, { features: doc.features, flags }), ...diffCoins(savedCoins, ownerCoins)]
    : []

  const siteList = site.data?.coins ?? []

  // The site's coins, then any custom coin defined here that the site does not show yet.
  const coins: (SiteCoin & { pending?: boolean })[] = [
    ...siteList,
    ...ownerCoins
      .filter(c => !siteList.some(s => s.code === c.code))
      .map(c => ({
        code: c.code,
        kind: c.kind,
        name: c.name,
        symbol: c.symbol ?? c.code,
        builtin: false,
        retired: false,
        imageUrl: null,
        ownerEnabled: c.enabled !== false,
        siteEnabled: null,
        networks: c.networks ?? [],
        pending: true
      }))
  ]

  const definitionFor = (code: string) => ownerCoins.find(c => c.code === code)

  const stageCoin = (def: CoinDefinition) =>
    setCoinDraft(prev => {
      const list = prev ?? savedCoins

      return list.some(c => c.code === def.code) ? list.map(c => (c.code === def.code ? def : c)) : [...list, def]
    })

  const discard = () => {
    setEdits({})
    setCoinDraft(null)
  }

  const nameOf = (key: string) => coins.find(c => flagOf(c.code) === key)?.name ?? flagLabel(key)

  const networkLabel = (key: string) => {
    const [code, net] = key.split(':')
    const coin = coins.find(c => flagOf(c.code) === code)

    return `${coin?.code ?? code.toUpperCase()} · ${coin?.networks.find(n => n.key.toLowerCase() === net)?.name ?? net.toUpperCase()} network`
  }

  const labelOf = (c: ToggleChange) =>
    c.key === MASTER ? flagLabel(MASTER) : c.key.includes(':') ? networkLabel(c.key) : `${nameOf(c.key)} (${c.key.toUpperCase()})`

  const on = (key: string) => flags[key] !== false
  const set = (key: string, value: boolean) => setEdits(prev => ({ ...prev, [key]: value }))

  const save = useApiMutation<void, SaveResult & { doc: EntitlementsDoc; changes: Change[] }>({
    // Only the flags change; features, variants and the template stay as stored.
    fn: () => api.put('/api/owner/entitlements', { version: doc!.version, features: {}, flags: edits, ...(coinDraft ? { coins: coinDraft } : {}) }),
    invalidate: [['api']],
    errorTitle: 'Coins not saved',
    onSuccess: r => {
      toastSaved(r, 'Coins saved')
      discard()
      setReviewing(false)
    }
  })

  if (error)
    return (
      <>
        <PageHeader title='Coins' />
        <ErrorState error={error} title='Could not load the entitlements document' onRetry={refetch} retrying={isRefetching} />
      </>
    )

  const changedKeys = new Set(changes.map(c => c.key))

  return (
    <div className={cn(changes.length > 0 && 'pb-20')}>
      <PageHeader
        title='Coins'
        description="Which of the site's coins, and which of their networks, are in the client's plan, and the site's own coins you create. Names, images, network names and the site's own switches are set in the site admin."
        actions={
          <Button variant='outline' disabled={!doc} onClick={() => setDialog({ editing: false, form: emptyForm(), key: Date.now() })}>
            <PlusIcon /> Add coin
          </Button>
        }
      />

      {site.error && (
        <div className='mb-4'>
          <ErrorState error={site.error} title="Could not load the site's coin list" onRetry={site.refetch} retrying={site.isRefetching} />
        </div>
      )}

      {site.data?.source === 'catalogue' && (
        <Alert className='mb-4'>
          <InfoIcon />
          <AlertTitle>The site did not answer</AlertTitle>
          <AlertDescription>
            Showing the coin flags from the catalogue without names or images ({site.data.reason ?? 'unreachable'}). Switches still save.
          </AlertDescription>
        </Alert>
      )}

      {isLoading || site.isLoading || !doc ? (
        <div className='flex flex-col gap-2'>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className='h-12 w-full' />
          ))}
        </div>
      ) : (
        <>
          <Card className='mb-4'>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <CoinsIcon className='size-4' /> Crypto wallets (master)
              </CardTitle>
              <CardDescription>Off takes every crypto coin out of the plan; each coin&apos;s switch below still applies when it is on.</CardDescription>
            </CardHeader>
            <CardContent className='flex items-center gap-3' data-row={MASTER}>
              <Switch checked={on(MASTER)} onCheckedChange={v => set(MASTER, v)} aria-label='Crypto wallets (master)' />
              <span className='text-sm'>{on(MASTER) ? 'In the plan' : 'Not in the plan'}</span>
              {changedKeys.has(MASTER) && <Badge variant='outline'>changed</Badge>}
            </CardContent>
          </Card>

          <Card>
            <CardContent className='p-0'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className='w-12' />
                    <TableHead>Coin</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Networks</TableHead>
                    <TableHead>On the site</TableHead>
                    <TableHead className='text-right'>In the plan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {coins.map(coin => {
                    const key = flagOf(coin.code)
                    const masterOff = coin.kind === 'crypto' && !on(MASTER)
                    const def = coin.builtin ? undefined : definitionFor(coin.code)
                    const changed = changedKeys.has(key) || changedKeys.has(coin.code) || [...changedKeys].some(k => k.startsWith(`${key}:`))

                    return (
                      <TableRow key={coin.code} data-row={key} className={cn(changed && 'bg-muted/40')}>
                        <TableCell>
                          <CoinImage coin={coin} />
                        </TableCell>
                        <TableCell>
                          <div className='font-medium'>{coin.name}</div>
                          <div className='text-muted-foreground font-mono text-xs'>
                            {coin.code}
                            {coin.symbol && coin.symbol !== coin.code ? ` · ${coin.symbol}` : ''}
                            {def?.usdRate ? ` · $${def.usdRate}` : ''}
                          </div>
                          {!coin.builtin && (
                            <div className='mt-1 flex flex-wrap gap-1'>
                              <Badge variant='secondary'>Custom</Badge>
                              {coin.pending && <Badge variant='outline'>{savedCoins.some(c => c.code === coin.code) ? 'not on the site yet' : 'unsaved'}</Badge>}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className='capitalize'>{coin.kind}</TableCell>
                        <TableCell>
                          <div className='flex flex-wrap gap-1'>
                            {coin.networks.length ? (
                              coin.networks.map(n =>
                                coin.builtin && coin.kind === 'crypto' ? (

                                  // A built-in coin's network: in the plan or not. Off hides it from players and the site admin.
                                  <label key={n.key} title={n.key} data-network={networkFlagOf(coin.code, n.key)} className='flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs'>
                                    <Switch
                                      size='sm'
                                      checked={on(networkFlagOf(coin.code, n.key))}
                                      onCheckedChange={v => set(networkFlagOf(coin.code, n.key), v)}
                                      aria-label={`${coin.code} ${n.name} network in the plan`}
                                    />
                                    {n.name}
                                  </label>
                                ) : (
                                  <Badge key={n.key} variant='secondary' title={n.key}>
                                    {n.name}
                                  </Badge>
                                )
                              )
                            ) : (
                              <span className='text-muted-foreground text-xs'>—</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {coin.retired ? (
                            <Badge variant='outline'>Retired</Badge>
                          ) : coin.siteEnabled === null ? (
                            <span className='text-muted-foreground text-xs'>unknown</span>
                          ) : (
                            <Badge variant={coin.siteEnabled ? 'default' : 'outline'}>{coin.siteEnabled ? 'On' : 'Off'}</Badge>
                          )}
                        </TableCell>
                        <TableCell className='text-right'>
                          <div className='flex items-center justify-end gap-2'>
                            {masterOff && <span className='text-muted-foreground text-xs'>master off</span>}
                            {def && (
                              <Button
                                variant='ghost'
                                size='icon'
                                aria-label={`Edit ${coin.code}`}
                                onClick={() => setDialog({ editing: true, form: formOf(def), key: Date.now() })}
                              >
                                <PencilIcon />
                              </Button>
                            )}
                            {def ? (

                              // A custom coin's own switch is its definition's `enabled` — never deleted, only off.
                              <Switch
                                checked={def.enabled !== false && on(key)}
                                onCheckedChange={v => stageCoin({ ...def, enabled: v })}
                                aria-label={`${coin.name} in the plan`}
                              />
                            ) : (
                              <Switch
                                checked={!coin.retired && on(key)}
                                disabled={coin.retired}
                                onCheckedChange={v => set(key, v)}
                                aria-label={`${coin.name} in the plan`}
                              />
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {changes.length > 0 && (
        <div className='bg-background/95 fixed inset-x-0 bottom-0 z-20 border-t backdrop-blur'>
          <div className='mx-auto flex max-w-7xl items-center justify-between gap-3 px-6 py-3'>
            <span className='text-sm'>
              {changes.length} unsaved change{changes.length === 1 ? '' : 's'}
            </span>
            <div className='flex gap-2'>
              <Button
                variant='outline'
                disabled={save.isPending}
                onClick={() => {
                  discard()
                  toast.info('Changes discarded')
                }}
              >
                Discard
              </Button>
              <Button onClick={() => (changes.length ? setReviewing(true) : toast.info('Nothing to save'))}>Review and save</Button>
            </div>
          </div>
        </div>
      )}

      {dialog && (
        <CoinDialog
          key={dialog.key}
          open
          editing={dialog.editing}
          initial={dialog.form}
          taken={code => isBuiltinCoin(code) || coins.some(c => c.code === code) || ownerCoins.some(c => c.code === code)}
          onClose={() => setDialog(null)}
          onApply={def => {
            stageCoin(def)
            setDialog(null)
          }}
        />
      )}

      <Dialog open={reviewing} onOpenChange={setReviewing}>
        <DialogContent className='sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>Save coins</DialogTitle>
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
              disabled={save.isPending}
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
              {save.isPending && <Loader2Icon className='animate-spin' />} Save {changes.length} change{changes.length === 1 ? '' : 's'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default Coins
