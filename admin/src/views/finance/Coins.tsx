'use client'

import { useEffect, useMemo, useState } from 'react'

import { ArrowDownIcon, ArrowUpIcon, ImageIcon, PencilIcon, UploadIcon } from 'lucide-react'

import Can from '@/components/shared/Can'
import DataTable, { type Column } from '@/components/shared/DataTable'
import FormDialog from '@/components/shared/FormDialog'
import { TextField } from '@/components/shared/FormField'
import PageHeader from '@/components/shared/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useSession } from '@/contexts/SessionContext'
import { useLivePoll } from '@/lib/realtime-status'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { check } from '@/lib/validate'

import type { CoinNetwork, CurrencyRow } from './types'
import { CURRENCIES_PATH } from './useCurrencyCodes'

/**
 * Finance → Coins: the site's coin registry (`GET admin/currencies`).
 *
 * Every coin in the owner's plan, with what players see — name, symbol, image, order, the names
 * of its networks — and its switch. A coin is on for players when the site has it on AND it is
 * not retired; coins the owner left out of the plan are not listed at all. Network KEYS are the contract a deposit or
 * withdrawal names, so only their display names and on/off are editable here. House staff only.
 */

const INVALIDATE = [['api', CURRENCIES_PATH]]
const ACCEPT = 'image/png,image/svg+xml,image/webp'
const MAX_BYTES = 200 * 1024

type Patch = Partial<{ name: string; symbol: string; sortOrder: number; enabled: boolean; networks: Array<Partial<CoinNetwork> & { key: string }> }>

const imageSrc = (row: CurrencyRow) =>
  row.imageVersion ? api.url(`admin/currencies/${row.code}/image`, { v: row.imageVersion }) : null

const CoinImage = ({ row, size = 28 }: { row: CurrencyRow; size?: number }) => {
  const src = imageSrc(row)

  if (!src) {
    return (
      <div style={{ width: size, height: size }} className='bg-muted text-muted-foreground flex items-center justify-center rounded-full text-[10px] font-semibold'>
        {row.code.slice(0, 3)}
      </div>
    )
  }

   
  return <img src={src} alt='' width={size} height={size} style={{ width: size, height: size }} className='rounded-full object-contain' />
}

/** currencies.validators.js `text()`: printable, no angle brackets. */
const displayText = (v: string, label: string, max: number) =>
  check.required(v, label) ?? check.length(v, label, { max }) ?? (/[<>\u0000-\u001f\u007f]/.test(v) ? `${label} cannot contain < > or control characters` : undefined)

const useUpdate = (code: string, success?: string | ((patch: Patch) => string)) =>
  useApiMutation<Patch>({
    fn: patch => api.put<CurrencyRow>(`${CURRENCIES_PATH}/${code}`, patch),
    invalidate: INVALIDATE,
    success: (_r, patch) => (typeof success === 'function' ? success(patch) : success ?? `${code} saved`)
  })

const EnabledSwitch = ({ row }: { row: CurrencyRow }) => {
  const update = useUpdate(row.code, p => `${row.code} switched ${p.enabled ? 'on' : 'off'}`)
  const title = row.retired ? 'Retired: never offered again' : row.siteEnabled ? 'Switch off' : 'Switch on'

  return (
    <Can permission='config:write' fallback={<Switch checked={row.enabled} disabled aria-label={`${row.code} enabled`} />}>
      <Switch
        checked={row.siteEnabled && !row.retired}
        disabled={update.isPending || row.retired}
        title={title}
        aria-label={`${row.code} enabled`}
        onCheckedChange={enabled => update.mutate({ enabled })}
      />
    </Can>
  )
}

const EditCoin = ({ row }: { row: CurrencyRow }) => {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: row.name, symbol: row.symbol, networks: row.networks })
  const update = useUpdate(row.code)

  const onOpenChange = (next: boolean) => {
    if (next) setForm({ name: row.name, symbol: row.symbol, networks: row.networks })
    setOpen(next)
  }

  const setNetwork = (key: string, patch: Partial<CoinNetwork>) =>
    setForm(f => ({ ...f, networks: f.networks.map(n => (n.key === key ? { ...n, ...patch } : n)) }))

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        <Button variant='ghost' size='sm'>
          <PencilIcon /> Edit
        </Button>
      }
      title={`Edit ${row.code}`}
      description='What players see in the wallet, the header balance and the cashier. The code, kind and decimals are fixed.'
      validate={() => ({
        name: displayText(form.name, 'Display name', 60),
        symbol: displayText(form.symbol, 'Symbol', 12),
        networks: form.networks.map(n => displayText(n.name, `Network ${n.key} name`, 40)).find(Boolean)
      })}
      onSubmit={() =>
        update.mutateAsync({
          name: form.name.trim(),
          symbol: form.symbol.trim(),
          ...(form.networks.length ? { networks: form.networks.map(n => ({ key: n.key, name: n.name.trim(), enabled: n.enabled })) } : {})
        })
      }
    >
      <div className='grid grid-cols-[1fr_8rem] gap-4'>
        <TextField id={`c-name-${row.code}`} name='name' label='Display name' required maxLength={60} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        <TextField id={`c-sym-${row.code}`} name='symbol' label='Symbol' required maxLength={12} value={form.symbol} onChange={e => setForm({ ...form, symbol: e.target.value })} />
      </div>
      {form.networks.length > 0 && (
        <Field className='gap-2'>
          <FieldLabel>Networks</FieldLabel>
          <FieldDescription>The key in brackets is what deposits and withdrawals carry; rename freely, switch off to stop offering it.</FieldDescription>
          <div className='grid gap-2'>
            {form.networks.map(n => (
              <div key={n.key} className='flex items-center gap-3 rounded-md border px-3 py-2'>
                <code className='text-muted-foreground w-16 shrink-0 text-xs'>{n.key}</code>
                <Input aria-label={`${n.key} name`} required maxLength={40} value={n.name} onChange={e => setNetwork(n.key, { name: e.target.value })} className='h-8' />
                <Switch aria-label={`${n.key} enabled`} checked={n.enabled} onCheckedChange={enabled => setNetwork(n.key, { enabled })} />
              </div>
            ))}
          </div>
        </Field>
      )}
    </FormDialog>
  )
}

const UploadImage = ({ row }: { row: CurrencyRow }) => {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview)
    },
    [preview]
  )

  const upload = useApiMutation({
    fn: () => {
      const fd = new FormData()

      if (file) fd.set('image', file)

      return api.upload<CurrencyRow>(`${CURRENCIES_PATH}/${row.code}/image`, fd)
    },
    invalidate: INVALIDATE,
    success: `${row.code} image replaced`
  })

  const onOpenChange = (next: boolean) => {
    if (next) {
      setFile(null)
      setProblem(null)
    }

    setOpen(next)
  }

  const pick = (f: File | null) => {
    setProblem(f && f.size > MAX_BYTES ? `That file is ${Math.ceil(f.size / 1024)} KB; the limit is 200 KB.` : null)
    setFile(f)
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        <Button variant='ghost' size='sm'>
          <ImageIcon /> Image
        </Button>
      }
      title={`${row.code} image`}
      description='PNG, SVG or WebP, at most 200 KB, square works best. An SVG with script, event handlers or external links is refused.'
      submitLabel='Upload'
      validate={() => (!file ? 'Choose an image file' : problem ? problem : !ACCEPT.split(',').includes(file.type) ? 'The image must be PNG, SVG or WebP' : undefined)}
      onSubmit={() => upload.mutateAsync()}
    >
      <div className='flex items-center gap-6'>
        <div className='grid justify-items-center gap-1'>
          <CoinImage row={row} size={56} />
          <span className='text-muted-foreground text-xs'>Now</span>
        </div>
        <div className='grid justify-items-center gap-1'>
          {preview ? (
             
            <img src={preview} alt='' width={56} height={56} className='size-14 rounded-full object-contain' />
          ) : (
            <div className='bg-muted text-muted-foreground flex size-14 items-center justify-center rounded-full'>
              <UploadIcon className='size-5' />
            </div>
          )}
          <span className='text-muted-foreground text-xs'>New</span>
        </div>
      </div>
      <Field className='gap-2'>
        <FieldLabel htmlFor={`c-img-${row.code}`}>File</FieldLabel>
        <Input id={`c-img-${row.code}`} type='file' accept={ACCEPT} onChange={e => pick(e.target.files?.[0] ?? null)} />
        {problem && <FieldDescription className='text-destructive'>{problem}</FieldDescription>}
      </Field>
    </FormDialog>
  )
}

const Reorder = ({ row, rows, index }: { row: CurrencyRow; rows: CurrencyRow[]; index: number }) => {
  const swap = useApiMutation<number>({
    fn: async delta => {
      const other = rows[index + delta]

      if (!other) return

      // Equal orders (never edited) would not move: spread them first.
      const a = row.sortOrder === other.sortOrder ? (index + 1) * 10 : row.sortOrder
      const b = row.sortOrder === other.sortOrder ? (index + 1 + delta) * 10 : other.sortOrder

      await api.put(`${CURRENCIES_PATH}/${row.code}`, { sortOrder: b })
      await api.put(`${CURRENCIES_PATH}/${other.code}`, { sortOrder: a })
    },
    invalidate: INVALIDATE,
    success: (_r, delta) => `${row.code} moved ${delta < 0 ? 'up' : 'down'}`
  })

  return (
    <div className='flex gap-0.5'>
      <Button variant='ghost' size='icon-sm' aria-label={`Move ${row.code} up`} disabled={index === 0 || swap.isPending} onClick={() => swap.mutate(-1)}>
        <ArrowUpIcon />
      </Button>
      <Button variant='ghost' size='icon-sm' aria-label={`Move ${row.code} down`} disabled={index === rows.length - 1 || swap.isPending} onClick={() => swap.mutate(1)}>
        <ArrowDownIcon />
      </Button>
    </div>
  )
}

const Networks = ({ networks }: { networks: CoinNetwork[] }) =>
  networks.length ? (
    <div className='flex flex-wrap gap-1'>
      {networks.map(n => (
        <Badge key={n.key} variant='outline' title={`${n.key}${n.enabled ? '' : ' (off)'}`} className={cn(!n.enabled && 'text-muted-foreground line-through')}>
          {n.name}
        </Badge>
      ))}
    </div>
  ) : (
    <span className='text-muted-foreground'>—</span>
  )

const State = ({ row }: { row: CurrencyRow }) => {
  if (row.retired) return <Badge variant='secondary'>Retired</Badge>

  return row.enabled ? <Badge variant='outline'>Live</Badge> : <Badge variant='secondary'>Off</Badge>
}

const Coins = () => {
  const { can, actor } = useSession()
  const house = actor?.promotions !== false
  const coinsPoll = useLivePoll(15_000)
  const coins = useApi<CurrencyRow[]>(house ? CURRENCIES_PATH : null, undefined, { refetchInterval: coinsPoll, refetchOnWindowFocus: true })

  // Coins outside the owner's plan are not the site's to see.
  const rows = useMemo(() => (coins.data ?? []).filter(c => c.ownerEnabled && !c.retired).sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code)), [coins.data])
  const writable = can('config:write')

  const columns: Column<CurrencyRow>[] = [
    ...(writable ? [{ key: 'order', header: '', cell: (r: CurrencyRow, i: number) => <Reorder row={r} rows={rows} index={i} /> }] : []),
    { key: 'img', header: '', cell: r => <CoinImage row={r} /> },
    { key: 'code', header: 'Code', cell: r => <span className='font-mono font-medium'>{r.code}</span> },
    { key: 'name', header: 'Name', cell: r => <span className='font-medium'>{r.name}</span> },
    { key: 'sym', header: 'Symbol', cell: r => r.symbol },
    { key: 'kind', header: 'Kind', cell: r => <span className='text-muted-foreground capitalize'>{r.kind}</span> },
    { key: 'net', header: 'Networks', cell: r => <Networks networks={r.networks} /> },
    { key: 'state', header: 'State', cell: r => <State row={r} /> },
    { key: 'on', header: 'Enabled', align: 'center', cell: r => <EnabledSwitch row={r} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: r => (
        <Can permission='config:write'>
          <div className='flex justify-end gap-1'>
            <EditCoin row={r} />
            <UploadImage row={r} />
          </div>
        </Can>
      )
    }
  ]

  return (
    <div>
      <PageHeader
        title='Coins'
        description='Every currency in your plan: what players see (name, symbol, image, order, network names) and whether it is offered.'
      />
      {house ? (
        <DataTable columns={columns} rows={rows} rowKey={r => r.code} loading={coins.isLoading} fetching={coins.isFetching} error={coins.error} dense />
      ) : (
        <p className='text-muted-foreground text-sm'>Coins are managed by the house.</p>
      )}
      <p className='text-muted-foreground mt-3 text-xs'>Players see a coin only when it is switched on here and not retired. Changes reach open player sites within seconds.</p>
    </div>
  )
}

export default Coins
