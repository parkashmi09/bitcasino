'use client'

import { useState } from 'react'

import { CheckCircle2Icon, ImageIcon, Loader2Icon, SaveIcon, SearchIcon, XCircleIcon } from 'lucide-react'

import Can from '@/components/shared/Can'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import DataTable, { type Column } from '@/components/shared/DataTable'
import ErrorState from '@/components/shared/ErrorState'
import FormDialog from '@/components/shared/FormDialog'
import { DateTimeField, SelectField, TextAreaField, TextField } from '@/components/shared/FormField'
import JsonView from '@/components/shared/JsonView'
import PageHeader from '@/components/shared/PageHeader'
import StatusBadge from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSession } from '@/contexts/SessionContext'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { check } from '@/lib/validate'
import type { Query } from '@/lib/api/types'
import { formatNumber } from '@/lib/format'
import type { GisGame, GisProvider, GisType, GisVendor, JsGame, JsScopeEntry } from './types'
import { TxnPasswordLabel } from '@/views/finance/StaffFloat'
import { useOwnerCoinFilter } from '@/views/finance/useCurrencyCodes'

const ALL = '__all__'

const Thumb = ({ src, alt }: { src?: string | null; alt: string }) =>
  src ? <img src={src} alt={alt} className='size-10 rounded object-cover' /> : <div className='bg-muted text-muted-foreground flex size-10 items-center justify-center rounded'><ImageIcon className='size-4' /></div>

const flag = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true'

/** Keeps an input's value locally and only pushes it up on Enter / blur, so a strict search route is not hit per keystroke. */
const SearchBox = ({ value, onCommit, placeholder }: { value: string; onCommit: (v: string) => void; placeholder: string }) => {
  const [v, setV] = useState(value)

  return (
    <div className='relative w-full sm:w-72'>
      <SearchIcon className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2' />
      <Input className='pl-8' placeholder={placeholder} value={v} onChange={e => setV(e.target.value)} onBlur={() => onCommit(v)} onKeyDown={e => e.key === 'Enter' && onCommit(v)} />
    </div>
  )
}

// ── Aggregator (GIS / Slotegrator) catalogue ────────────────────────────────

export const EditImage = ({ game, onSaved }: { game: Pick<GisGame, 'uuid' | 'name' | 'image'>; onSaved?: () => void }) => {
  const [image, setImage] = useState(game.image ?? '')

  const save = useApiMutation({
    fn: () => api.put(`admin/casino/games/catalogue/${encodeURIComponent(game.uuid)}/image`, { image }),
    invalidate: [['api', 'admin/casino/games/catalogue/search'], ['api', 'admin/casino/games/vendor-search'], ['api', 'admin/casino/games/type-search']],
    success: 'Image updated',
    onSuccess: () => onSaved?.()
  })

  return (
    <FormDialog
      trigger={
        <Button size='sm' variant='ghost'>
          <ImageIcon /> Image
        </Button>
      }
      title={`Tile image — ${game.name}`}
      description='The URL the lobby tile loads. Absolute URL, up to 2048 characters.'
      onSubmit={() => save.mutateAsync()}
      validate={() => ({ img: check.url(image, 'Image URL') || check.length(image, 'Image URL', { max: 2048 }) })}
    >
      <TextField id='img' label='Image URL' required value={image} onChange={e => setImage(e.target.value)} />
      {image && <img src={image} alt='' className='max-h-40 rounded object-contain' />}
    </FormDialog>
  )
}

const gisColumns: Column<GisGame>[] = [
  { key: 'img', header: '', cell: r => <Thumb src={r.image} alt={r.name} /> },
  {
    key: 'name',
    header: 'Game',
    cell: r => (
      <div>
        <div className='font-medium'>{r.name}</div>
        <div className='text-muted-foreground font-mono text-xs'>{r.uuid}</div>
      </div>
    )
  },
  { key: 'provider', header: 'Provider', cell: r => r.provider ?? '—' },
  { key: 'type', header: 'Type', cell: r => <Badge variant='outline'>{r.type ?? '—'}</Badge> },
  { key: 'mobile', header: 'Mobile', align: 'center', cell: r => (flag(r.is_mobile) ? <CheckCircle2Icon className='mx-auto size-4 text-green-600' /> : <XCircleIcon className='text-muted-foreground mx-auto size-4' />) },
  { key: 'fs', header: 'Free spins', align: 'center', cell: r => (flag(r.has_freespins) ? <CheckCircle2Icon className='mx-auto size-4 text-green-600' /> : <span className='text-muted-foreground'>—</span>) },
  {
    key: 'actions',
    header: '',
    align: 'right',
    cell: r => (
      <Can permission='casino:manage'>
        <EditImage game={r} />
      </Can>
    )
  }
]

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- its tab is hidden for now; it comes back with it
const GisTab = () => {
  // Free spins are a promotion; agent-tree logins (no promotions) don't see the column.
  const promotions = useSession().actor?.promotions === true
  const columns = promotions ? gisColumns : gisColumns.filter(c => c.key !== 'fs')
  const [q, setQ] = useState('')
  const [vendor, setVendor] = useState(ALL)
  const [type, setType] = useState(ALL)
  const [limit, setLimit] = useState(50)
  const vendors = useApi<GisVendor[]>('admin/casino/games/vendors')
  const types = useApi<GisType[]>('admin/casino/games/types')

  // Three strict routes, one per filter shape — the catalogue search takes no vendor/type key.
  const path = vendor !== ALL ? 'admin/casino/games/vendor-search' : type !== ALL ? 'admin/casino/games/type-search' : 'admin/casino/games/catalogue/search'
  const query: Query = { q, limit, ...(vendor !== ALL ? { vendor } : type !== ALL ? { type } : {}) }
  const list = useApi<GisGame[]>(path, query)

  return (
    <DataTable
      columns={columns}
      rows={list.data}
      rowKey={r => r.uuid}
      loading={list.isLoading}
      fetching={list.isFetching}
      error={list.error}
      emptyMessage='No games match. If the catalogue is empty, run "Sync games from provider" on the Providers tab.'
      toolbar={
        <>
          <SearchBox value={q} onCommit={setQ} placeholder='Game name… (Enter to search)' />
          <Select
            value={vendor}
            onValueChange={v => {
              if (!v) return
              setVendor(v)
              if (v !== ALL) setType(ALL)
            }}
          >
            <SelectTrigger className='w-48'>
              <SelectValue placeholder='Vendor'>{(v: string) => (v === ALL ? 'All vendors' : v)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All vendors</SelectItem>
              {(vendors.data ?? []).map(v => (
                <SelectItem key={v.vendor} value={v.vendor}>
                  {v.vendor} {v.total !== undefined ? `(${formatNumber(v.total)})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={type}
            onValueChange={v => {
              if (!v) return
              setType(v)
              if (v !== ALL) setVendor(ALL)
            }}
          >
            <SelectTrigger className='w-44'>
              <SelectValue placeholder='Type'>{(v: string) => (v === ALL ? 'All types' : v)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All types</SelectItem>
              {(types.data ?? []).map(t => (
                <SelectItem key={t.type} value={t.type}>
                  {t.type} {t.total !== undefined ? `(${formatNumber(t.total)})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(limit)} onValueChange={v => v && setLimit(Number(v))}>
            <SelectTrigger className='w-28'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[25, 50, 100].map(n => (
                <SelectItem key={n} value={String(n)}>
                  Top {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      }
    />
  )
}

// ── JS games (what the stake lobby renders) ─────────────────────────────────

const EditIcon = ({ game }: { game: JsGame }) => {
  const [icon, setIcon] = useState(game.game_icon ?? '')

  const save = useApiMutation({
    fn: () => api.put(`admin/casino/js-games/v1/catalogue/${encodeURIComponent(game.game_uid)}/icon`, { icon }),
    invalidate: [['api', 'admin/casino/js-games/v1/catalogue/search']],
    success: 'Icon updated'
  })

  return (
    <FormDialog
      trigger={
        <Button size='sm' variant='ghost'>
          <ImageIcon /> Icon
        </Button>
      }
      title={`Icon — ${game.game_name}`}
      description='Absolute URL, up to 500 characters.'
      onSubmit={() => save.mutateAsync()}
      validate={() => ({ icon: check.url(icon, 'Icon URL') || check.length(icon, 'Icon URL', { max: 500 }) })}
    >
      <TextField id='icon' label='Icon URL' type='url' required value={icon} onChange={e => setIcon(e.target.value)} />
      {icon && <img src={icon} alt='' className='max-h-40 rounded object-contain' />}
    </FormDialog>
  )
}

const jsColumns: Column<JsGame>[] = [
  { key: 'img', header: '', cell: r => <Thumb src={r.game_icon} alt={r.game_name} /> },
  {
    key: 'name',
    header: 'Game',
    cell: r => (
      <div>
        <div className='font-medium'>{r.game_name}</div>
        <div className='text-muted-foreground font-mono text-xs'>{r.game_uid}</div>
      </div>
    )
  },
  { key: 'vendor', header: 'Vendor', cell: r => r.vendor ?? '—' },
  { key: 'type', header: 'Type', cell: r => <Badge variant='outline'>{r.game_type ?? '—'}</Badge> },
  { key: 'active', header: 'Active', cell: r => <StatusBadge value={r.is_active ? 'active' : 'inactive'} /> },
  {
    key: 'actions',
    header: '',
    align: 'right',
    cell: r => (
      <Can permission='casino:manage'>
        <EditIcon game={r} />
      </Can>
    )
  }
]

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- its tab is hidden for now; it comes back with it
const JsTab = () => {
  const [q, setQ] = useState('')
  const [vendor, setVendor] = useState(ALL)
  const [type, setType] = useState(ALL)
  const [inactive, setInactive] = useState(false)
  const vendors = useApi<JsScopeEntry[]>('admin/casino/js-games/v1/vendors')
  const types = useApi<JsScopeEntry[]>('admin/casino/js-games/v1/types')

  const list = useApi<JsGame[]>('admin/casino/js-games/v1/catalogue/search', {
    q,
    limit: 100,
    include_inactive: inactive ? 'true' : undefined,
    vendor: vendor !== ALL ? vendor : undefined,
    type: type !== ALL ? type : undefined
  })

  return (
    <DataTable
      columns={jsColumns}
      rows={list.data}
      rowKey={r => r.game_uid}
      loading={list.isLoading}
      fetching={list.isFetching}
      error={list.error}
      emptyMessage='No lobby games match.'
      toolbar={
        <>
          <SearchBox value={q} onCommit={setQ} placeholder='Game name… (Enter to search)' />
          <Select value={vendor} onValueChange={v => v && setVendor(v)}>
            <SelectTrigger className='w-44'>
              <SelectValue>{(v: string) => (v === ALL ? 'All vendors' : v)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All vendors</SelectItem>
              {(vendors.data ?? []).map(v => (
                <SelectItem key={v.name} value={v.name ?? ''}>
                  {v.name} ({v.games})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={type} onValueChange={v => v && setType(v)}>
            <SelectTrigger className='w-44'>
              <SelectValue>{(v: string) => (v === ALL ? 'All types' : v)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All types</SelectItem>
              {(types.data ?? []).map(t => (
                <SelectItem key={t.name} value={t.name ?? ''}>
                  {t.name} ({t.games})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className='flex items-center gap-2 text-sm'>
            <Switch checked={inactive} onCheckedChange={setInactive} /> Include inactive
          </label>
        </>
      }
    />
  )
}

// ── Upstream providers + syncs ──────────────────────────────────────────────

const ProvidersTab = () => {
  const { can } = useSession()
  const providers = useApi<GisProvider[]>('admin/casino/games/providers')
  const [draft, setDraft] = useState<Record<string, boolean>>({})
  const [filter, setFilter] = useState('')
  const [tp, setTp] = useState('')
  const canManage = can('casino:manage')

  const current = (name: string, enabled: boolean) => (name in draft ? draft[name] : enabled)
  const updates = (providers.data ?? []).filter(p => name(p) in draft && draft[name(p)] !== p.enabled).map(p => ({ name: name(p), enabled: draft[name(p)] }))

  function name(p: GisProvider) {
    return p.name
  }

  const save = useApiMutation({
    fn: () => api.put('admin/casino/games/providers', { updates, transactionPassword: tp }),
    invalidate: [['api', 'admin/casino/games/providers'], ['api', 'admin/casino/games/provider-settings']], // The same switch as Casino → Providers, so that screen re-reads too.
    success: `${updates.length} provider${updates.length === 1 ? '' : 's'} updated`,
    onSuccess: () => {
      setDraft({})
      setTp('')
    }
  })

  const rows = (providers.data ?? []).filter(p => !filter || p.name.toLowerCase().includes(filter.toLowerCase()))

  return (
    <div className='grid gap-6'>
      <Card className='shadow-none'>
        <CardHeader className='flex flex-wrap items-center justify-between gap-3'>
          <div>
            <CardTitle className='text-base'>Upstream providers</CardTitle>
            <CardDescription>The aggregator feed&apos;s provider list. Each switch is the same one as Casino → Providers: off takes the provider&apos;s games out of the lobby, search, favourites and recently played, and refuses their launches.</CardDescription>
          </div>
          <div className='flex items-center gap-2'>
            <Input placeholder='Filter…' className='w-40' value={filter} onChange={e => setFilter(e.target.value)} />
            <FormDialog
              trigger={
                <Button disabled={!updates.length || !canManage}>
                  <SaveIcon /> Save {updates.length ? `(${updates.length})` : ''}
                </Button>
              }
              title='Confirm provider changes'
              description='Your transaction password is required for this change.'
              submitLabel='Apply'
              onSubmit={() => save.mutateAsync()}
              validate={() => ({ tp: check.required(tp, 'Transaction password') })}
            >
              <ul className='text-sm'>
                {updates.map(u => (
                  <li key={u.name}>
                    {u.name} → <StatusBadge value={u.enabled} />
                  </li>
                ))}
              </ul>
              <TextField id='tp' label={<TxnPasswordLabel />} type='password' required value={tp} onChange={e => setTp(e.target.value)} />
            </FormDialog>
          </div>
        </CardHeader>
        <CardContent>
          {providers.error && <ErrorState error={providers.error} />}
          {providers.data && providers.data.length === 0 && <p className='text-muted-foreground text-sm'>No providers loaded yet.</p>}
          <div className='grid gap-1 sm:grid-cols-2 xl:grid-cols-3'>
            {rows.map(p => {
              const on = current(p.name, p.enabled)
              const changed = on !== p.enabled

              return (
                <label key={p.name} className={`flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm ${changed ? 'border-primary/60 bg-primary/5' : 'border-transparent hover:bg-muted/50'}`}>
                  <span className='truncate'>{p.name}</span>
                  <Switch checked={on} disabled={!canManage} onCheckedChange={v => setDraft(d => ({ ...d, [p.name]: v }))} />
                </label>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ── Free spins & vouchers ───────────────────────────────────────────────────

const toEpoch = (s: string) => Math.floor(new Date(s).getTime() / 1000)

/** The currencies GIS free spins and vouchers take. */
const GIS_CURRENCIES = ['INR', 'USDT'] as const

/** The GIS currencies in the owner's plan, and the form's pick (or the first of them when it is out). */
const useGisCurrency = (picked: string) => {
  const options = useOwnerCoinFilter()(GIS_CURRENCIES)

  return { options: options.map(c => ({ value: c, label: c })), currency: options.includes(picked) ? picked : (options[0] ?? '') }
}

const CreateFreespin = () => {
  const [f, setF] = useState({ playerId: '', playerName: '', currency: 'INR', quantity: '10', validFrom: '', validUntil: '', freespinId: '', gameUuid: '', denomination: '' })
  const cur = useGisCurrency(f.currency)

  const create = useApiMutation({
    fn: () => {
      const body: Record<string, unknown> = {
        playerId: Number(f.playerId),
        playerName: f.playerName,
        currency: cur.currency,
        quantity: Number(f.quantity),
        validFrom: toEpoch(f.validFrom),
        validUntil: toEpoch(f.validUntil),
        freespinId: f.freespinId,
        gameUuid: f.gameUuid
      }

      if (f.denomination) body.denomination = Number(f.denomination)

      return api.post('admin/casino/gis/freespins', body)
    },
    success: 'Free spin campaign created'
  })

  return (
    <FormDialog
      trigger={<Button>New campaign</Button>}
      title='Create a free spin campaign'
      description='Grants a named user free spins on one game between two dates.'
      submitLabel='Create'
      onSubmit={() => create.mutateAsync()}
      validate={() => ({
        'fs-id': check.required(f.freespinId, 'Campaign id') || check.length(f.freespinId, 'Campaign id', { max: 190 }),
        'fs-game': check.required(f.gameUuid, 'Game UUID'),
        'fs-pid': check.id(f.playerId, 'User id'),
        'fs-pname': check.required(f.playerName, 'User name') || check.length(f.playerName, 'User name', { max: 120 }),
        'fs-cur': cur.currency ? undefined : 'No casino currency is enabled for this site',
        'fs-qty': check.number(f.quantity, 'Spins', { integer: true, min: 1, max: 10000 }),
        'fs-from': check.required(f.validFrom, 'Valid from'),
        'fs-until': check.required(f.validUntil, 'Valid until') || (f.validFrom && toEpoch(f.validUntil) <= toEpoch(f.validFrom) ? 'Valid until must be after valid from' : undefined),
        'fs-denom': check.number(f.denomination, 'Denomination', { positive: true, optional: true })
      })}
      wide
    >
      <div className='grid grid-cols-2 gap-4'>
        <TextField id='fs-id' label='Campaign id' required value={f.freespinId} onChange={e => setF({ ...f, freespinId: e.target.value })} hint='Your reference; must be unique' />
        <TextField id='fs-game' label='Game UUID' required value={f.gameUuid} onChange={e => setF({ ...f, gameUuid: e.target.value })} />
        <TextField id='fs-pid' label='User id' required type='number' value={f.playerId} onChange={e => setF({ ...f, playerId: e.target.value })} />
        <TextField id='fs-pname' label='User name' required value={f.playerName} onChange={e => setF({ ...f, playerName: e.target.value })} />
        <SelectField id='fs-cur' label='Currency' value={cur.currency} onChange={currency => setF({ ...f, currency })} options={cur.options} />
        <TextField id='fs-qty' label='Spins' required type='number' min={1} max={10000} value={f.quantity} onChange={e => setF({ ...f, quantity: e.target.value })} />
        <DateTimeField id='fs-from' label='Valid from' required value={f.validFrom} onChange={validFrom => setF({ ...f, validFrom })} />
        <DateTimeField id='fs-until' label='Valid until' required min={f.validFrom} defaultTime='23:59' value={f.validUntil} onChange={validUntil => setF({ ...f, validUntil })} />
        <TextField id='fs-denom' label='Denomination' value={f.denomination} onChange={e => setF({ ...f, denomination: e.target.value })} hint='Optional bet size per spin' />
      </div>
    </FormDialog>
  )
}

const CreateVoucher = () => {
  const [f, setF] = useState({ playerId: '', voucherId: '', title: '', currency: 'INR', initialBalance: '', maxWinnings: '', validUntil: '', tableIds: '', shortTerms: '' })
  const cur = useGisCurrency(f.currency)

  const create = useApiMutation({
    fn: () => {
      const body: Record<string, unknown> = {
        playerId: Number(f.playerId),
        voucherId: f.voucherId,
        title: f.title,
        currency: cur.currency,
        initialBalance: Number(f.initialBalance),
        maxWinnings: Number(f.maxWinnings),
        validUntil: toEpoch(f.validUntil),
        tableIds: f.tableIds.split(',').map(s => s.trim()).filter(Boolean)
      }

      if (f.shortTerms) body.shortTerms = f.shortTerms

      return api.post('admin/casino/gis/vouchers', body)
    },
    success: 'Voucher created'
  })

  return (
    <FormDialog
      trigger={<Button>New voucher</Button>}
      title='Create a table voucher'
      description='Table credit with a winnings cap for one user.'
      submitLabel='Create'
      onSubmit={() => create.mutateAsync()}
      validate={() => {
        const tables = f.tableIds.split(',').map(t => t.trim()).filter(Boolean)

        return {
          'v-id': check.required(f.voucherId, 'Voucher id') || check.length(f.voucherId, 'Voucher id', { max: 190 }),
          'v-title': check.required(f.title, 'Title') || check.length(f.title, 'Title', { max: 200 }),
          'v-pid': check.id(f.playerId, 'User id'),
          'v-cur': cur.currency ? undefined : 'No casino currency is enabled for this site',
          'v-bal': check.number(f.initialBalance, 'Initial balance', { positive: true }),
          'v-max': check.number(f.maxWinnings, 'Max winnings', { positive: true }),
          'v-until': check.required(f.validUntil, 'Valid until') || (new Date(f.validUntil).getTime() <= Date.now() ? 'Valid until must be in the future' : undefined),
          'v-tables': !tables.length ? 'Enter at least one table id' : tables.length > 200 ? 'At most 200 table ids' : tables.some(t => t.length > 120) ? 'Each table id must be at most 120 characters' : undefined,
          'v-terms': check.length(f.shortTerms, 'Short terms', { max: 2000 })
        }
      }}
      wide
    >
      <div className='grid grid-cols-2 gap-4'>
        <TextField id='v-id' label='Voucher id' required value={f.voucherId} onChange={e => setF({ ...f, voucherId: e.target.value })} />
        <TextField id='v-title' label='Title' required value={f.title} onChange={e => setF({ ...f, title: e.target.value })} />
        <TextField id='v-pid' label='User id' required type='number' value={f.playerId} onChange={e => setF({ ...f, playerId: e.target.value })} />
        <SelectField id='v-cur' label='Currency' value={cur.currency} onChange={currency => setF({ ...f, currency })} options={cur.options} />
        <TextField id='v-bal' label='Initial balance' required value={f.initialBalance} onChange={e => setF({ ...f, initialBalance: e.target.value })} />
        <TextField id='v-max' label='Max winnings' required value={f.maxWinnings} onChange={e => setF({ ...f, maxWinnings: e.target.value })} />
        <DateTimeField id='v-until' label='Valid until' required defaultTime='23:59' value={f.validUntil} onChange={validUntil => setF({ ...f, validUntil })} />
        <TextField id='v-tables' label='Table ids' required value={f.tableIds} onChange={e => setF({ ...f, tableIds: e.target.value })} hint='Comma-separated' />
      </div>
      <TextAreaField id='v-terms' label='Short terms' value={f.shortTerms} onChange={e => setF({ ...f, shortTerms: e.target.value })} />
    </FormDialog>
  )
}

const Lookup = ({ kind }: { kind: 'freespins' | 'vouchers' }) => {
  const idKey = kind === 'freespins' ? 'freespinId' : 'voucherId'
  const [id, setId] = useState('')
  const [lookup, setLookup] = useState<string | null>(null)
  const q = useApi<unknown>(lookup ? `admin/casino/gis/${kind}` : null, { [idKey]: lookup })
  const [reason, setReason] = useState('Canceled')

  const cancel = useApiMutation({
    fn: () => api.post(`admin/casino/gis/${kind}/cancel`, kind === 'freespins' ? { freespinId: lookup } : { voucherId: lookup, reason }),
    invalidate: [['api', `admin/casino/gis/${kind}`]],
    success: 'Cancelled'
  })

  return (
    <Card className='shadow-none'>
      <CardHeader className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <CardTitle className='text-base'>{kind === 'freespins' ? 'Free spin campaigns' : 'Table vouchers'}</CardTitle>
          <CardDescription>The provider answers per id — there is no list route. Enter the id you were given at creation.</CardDescription>
        </div>
        <Can permission='casino:manage'>{kind === 'freespins' ? <CreateFreespin /> : <CreateVoucher />}</Can>
      </CardHeader>
      <CardContent className='grid gap-3'>
        <form
          className='flex gap-2'
          onSubmit={e => {
            e.preventDefault()
            setLookup(id.trim() || null)
          }}
        >
          <Input placeholder={`${idKey}…`} value={id} onChange={e => setId(e.target.value)} className='max-w-xs' />
          <Button type='submit' variant='outline' disabled={!id.trim()}>
            <SearchIcon /> Look up
          </Button>
          {lookup && q.data !== undefined && (
            <Can permission='casino:manage'>
              <ConfirmDialog trigger={<Button variant='destructive'>Cancel {kind === 'freespins' ? 'campaign' : 'voucher'}</Button>} title={`Cancel ${lookup}?`} destructive confirmLabel='Cancel it' onConfirm={() => cancel.mutateAsync()}>
                {kind === 'vouchers' && <SelectField id='v-reason' label='Reason' value={reason} onChange={setReason} options={[{ value: 'Canceled', label: 'Cancelled by operator' }, { value: 'Forfeited', label: 'Forfeited by user' }]} />}
              </ConfirmDialog>
            </Can>
          )}
        </form>
        {q.error && <ErrorState error={q.error} />}
        {q.isLoading && <Loader2Icon className='text-muted-foreground size-4 animate-spin' />}
        {q.data !== undefined && <JsonView value={q.data} />}
      </CardContent>
    </Card>
  )
}

const ToolsTab = () => (
  <div className='grid gap-6 xl:grid-cols-2'>
    <Lookup kind='freespins' />
    <Lookup kind='vouchers' />
  </div>
)

const GameCatalogue = () => {
  const [tab, setTab] = useState('providers')

  // Free spins and vouchers are promotions: agent-tree logins do not get the tab.
  const promotions = useSession().actor?.promotions === true

  return (
    <div>
      <PageHeader title='Game catalogue' description={`The casino catalogue, the lobby games the site renders${promotions ? ', upstream providers, and provider promotions' : ' and upstream providers'}.`} />
      <Tabs value={tab} onValueChange={v => setTab(String(v))}>
        <TabsList className='mb-4 flex-wrap'>
          {/* Aggregator games and Lobby games tabs hidden for now (user's request, 2026-10-20). */}
          <TabsTrigger value='providers'>Providers & sync</TabsTrigger>
          {promotions && <TabsTrigger value='tools'>Free spins & vouchers</TabsTrigger>}
        </TabsList>
        <TabsContent value='providers'>
          <ProvidersTab />
        </TabsContent>
        {promotions && (
          <TabsContent value='tools'>
            <ToolsTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}

export default GameCatalogue
