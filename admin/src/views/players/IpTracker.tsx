'use client'

import { useEffect, useState } from 'react'

import Link from 'next/link'

import { ChevronDownIcon, ChevronRightIcon, CopyIcon, RotateCcwIcon, SearchIcon, ShieldAlertIcon } from 'lucide-react'
import { toast } from 'sonner'

import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import ChannelTabs, { type Channel } from '@/components/shared/ChannelTabs'
import PageHeader from '@/components/shared/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DateRangePicker } from '@/components/ui/date-picker'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useListState, usePagedApi } from '@/hooks/use-api'
import GeoAttribution from './GeoAttribution'
import GeoStats from './GeoStats'
import { RiskManagementDialog } from './RiskManagement'
import type { IpLoginRow, SharedIpRow } from './types'

/**
 * `GET admin/reports/ip-tracker` and `…/ip-tracker/shared` — both `reports:read`, scoped to the
 * caller's tree by the backend. Strict validator: `search`, `ip` (exact, or a prefix ending in `*`
 * or `.`), `country` (ISO code or part of a name), `source` (login | register), `from` / `to`
 * (YYYY-MM-DD, inclusive), `proxyOnly`, `limit`, `offset`.
 */
const LOGINS = 'admin/reports/ip-tracker'
const SHARED = 'admin/reports/ip-tracker/shared'
const ALL = 'all'
const DEBOUNCE_MS = 350

const flag = (cc?: string | null) =>
  cc && /^[A-Z]{2}$/i.test(cc) ? String.fromCodePoint(...[...cc.toUpperCase()].map(c => 0x1f1a5 + c.charCodeAt(0))) : ''

const copy = (text: string) => {
  navigator.clipboard
    .writeText(text)
    .then(() => toast.success(`Copied ${text}`))
    .catch(() => toast.error('Could not copy'))
}

const Ip = ({ ip, isPrivate }: { ip: string | null; isPrivate?: boolean }) => {
  if (!ip) return <span className='text-muted-foreground'>—</span>

  return (
    <span className='inline-flex items-center gap-1'>
      <span className='font-mono text-sm'>{ip}</span>
      <Button
        variant='ghost'
        size='icon-xs'
        aria-label={`Copy ${ip}`}
        title='Copy IP'
        onClick={e => {
          e.stopPropagation()
          copy(ip)
        }}
      >
        <CopyIcon />
      </Button>
      {isPrivate && (
        <Badge variant='outline' title='Loopback or private address — never geolocated'>
          Local
        </Badge>
      )}
    </span>
  )
}

type RiskTarget = { id: string; name: string }

/** The user's page, and a shield that opens their Risk Management view in place. */
const UserLink = ({ id, name, onRisk }: RiskTarget & { onRisk: (u: RiskTarget) => void }) => (
  <span className='inline-flex items-center gap-1'>
    <Link href={`/users/${id}`} className='text-sm hover:underline' onClick={e => e.stopPropagation()}>
      {name || `#${id}`}
      <span className='text-muted-foreground ml-1 font-mono text-xs'>#{id}</span>
    </Link>
    <Button
      variant='ghost'
      size='icon-xs'
      aria-label={`Risk Management for ${name || `#${id}`}`}
      title='Risk Management'
      onClick={e => {
        e.stopPropagation()
        onRisk({ id, name })
      }}
    >
      <ShieldAlertIcon />
    </Button>
  </span>
)

const Network = ({ isProxy, isHosting }: { isProxy: boolean | null; isHosting: boolean | null }) =>
  isProxy || isHosting ? (
    <Badge variant='destructive'>{isProxy ? 'Proxy / VPN' : 'Hosting'}</Badge>
  ) : isProxy === false ? (
    <span className='text-muted-foreground text-sm'>Residential</span>
  ) : (
    <span className='text-muted-foreground text-sm'>—</span>
  )

const loginColumnsFor = (onRisk: (u: RiskTarget) => void): Column<IpLoginRow>[] => [
  { key: 'at', header: 'When', cell: r => <DateTime value={r.createdAt} /> },
  { key: 'user', header: 'User', cell: r => <UserLink id={r.user.id} name={r.user.name} onRisk={onRisk} /> },
  { key: 'ip', header: 'IP', cell: r => <Ip ip={r.ipAddress} isPrivate={r.isPrivate} /> },
  {
    key: 'where',
    header: 'Location',
    cell: r => (
      <span className='text-sm'>
        {flag(r.countryCode)}{' '}
        {[r.city, r.region, r.country].filter(Boolean).join(', ') || (
          <span className='text-muted-foreground'>not resolved</span>
        )}
      </span>
    )
  },
  {
    key: 'isp',
    header: 'Provider',
    cell: r => (
      <span className='text-sm'>
        {r.isp ?? '—'}
        {r.asn && <span className='text-muted-foreground block text-xs'>{r.asn}</span>}
      </span>
    )
  },
  { key: 'net', header: 'Network', cell: r => <Network isProxy={r.isProxy} isHosting={r.isHosting} /> },
  { key: 'src', header: 'Event', cell: r => <Badge variant='outline'>{r.source ?? 'login'}</Badge> },
  {
    key: 'ua',
    header: 'Device',
    cell: r => (
      <span className='text-muted-foreground line-clamp-2 max-w-72 text-xs' title={r.userAgent ?? undefined}>
        {r.userAgent ?? '—'}
      </span>
    )
  }
]

/** A text filter whose box updates at once and whose URL param follows once typing pauses. */
const useDebounced = (value: string, apply: (next: string) => void) => {
  const [term, setTerm] = useState(value)

  useEffect(() => {
    const next = term.trim()

    if (next === value) return
    const t = setTimeout(() => apply(next), DEBOUNCE_MS)

    return () => clearTimeout(t)
  }, [term, value, apply])

  return [term, setTerm] as const
}

const IpTrackerList = ({ channel }: { channel: Channel }) => {
  const { state, set, query } = useListState(['tab', 'ip', 'country', 'source', 'from', 'to', 'proxyOnly'])
  const tab = state.tab === 'shared' ? 'shared' : state.tab === 'countries' ? 'countries' : 'logins'
  const [open, setOpen] = useState<Set<string>>(() => new Set())

  // The last player stays set while the dialog closes, so its header does not blank mid-animation.
  const [risk, setRisk] = useState<RiskTarget | null>(null)
  const [riskOpen, setRiskOpen] = useState(false)

  const openRisk = (u: RiskTarget) => {
    setRisk(u)
    setRiskOpen(true)
  }

  const loginColumns = loginColumnsFor(openRisk)

  const [search, setSearch] = useDebounced(String(state.search ?? ''), v => set({ search: v }))
  const [ip, setIp] = useDebounced(String(state.ip ?? ''), v => set({ ip: v }))
  const [country, setCountry] = useDebounced(String(state.country ?? ''), v => set({ country: v }))

  const filters = {
    page: query.page,
    limit: query.limit,
    search: query.search,
    ip: query.ip,
    country: query.country,
    source: query.source,
    from: query.from,
    to: query.to,
    proxyOnly: query.proxyOnly === 'true' ? 'true' : undefined,
    channel
  }

  const logins = usePagedApi<IpLoginRow>(tab === 'logins' ? LOGINS : null, filters, { retry: false })
  const shared = usePagedApi<SharedIpRow>(tab === 'shared' ? SHARED : null, filters, { retry: false })

  const filtered = Boolean(
    query.search || query.ip || query.country || query.source || query.from || query.to || query.proxyOnly
  )

  const reset = () => {
    setSearch('')
    setIp('')
    setCountry('')
    set({ search: '', ip: '', country: '', source: '', from: '', to: '', proxyOnly: '' })
  }

  const toggle = (key: string) =>
    setOpen(prev => {
      const next = new Set(prev)

      if (next.has(key)) next.delete(key)
      else next.add(key)

      return next
    })

  const sharedColumns: Column<SharedIpRow>[] = [
    {
      key: 'x',
      header: '',
      className: 'w-8',
      cell: r => (
        <Button
          variant='ghost'
          size='icon-xs'
          aria-label={open.has(r.ipAddress) ? 'Hide accounts' : 'Show accounts'}
          aria-expanded={open.has(r.ipAddress)}
          onClick={e => {
            e.stopPropagation()
            toggle(r.ipAddress)
          }}
        >
          {open.has(r.ipAddress) ? <ChevronDownIcon /> : <ChevronRightIcon />}
        </Button>
      )
    },
    { key: 'ip', header: 'IP', cell: r => <Ip ip={r.ipAddress} isPrivate={r.isPrivate} /> },
    {
      key: 'accounts',
      header: 'Accounts',
      align: 'right',
      cell: r => <span className='font-medium tabular-nums'>{r.accounts}</span>
    },
    { key: 'logins', header: 'Logins', align: 'right', cell: r => <span className='tabular-nums'>{r.logins}</span> },
    {
      key: 'countries',
      header: 'Countries',
      cell: r =>
        r.countries.length ? (
          <span className='text-sm'>
            {r.countryCodes.map(flag).join(' ')} {r.countries.join(', ')}
          </span>
        ) : (
          <span className='text-muted-foreground text-sm'>not resolved</span>
        )
    },
    {
      key: 'net',
      header: 'Network',
      cell: r =>
        r.proxyOrHosting ? (
          <Badge variant='destructive'>Proxy / VPN</Badge>
        ) : (
          <span className='text-muted-foreground text-sm'>{r.isp ?? '—'}</span>
        )
    },
    {
      key: 'users',
      header: 'Users',
      cell: r => (
        <span className='flex flex-wrap items-center gap-x-3 gap-y-1'>
          {r.users.slice(0, 3).map(u => (
            <UserLink key={u.id} id={u.id} name={u.name} onRisk={openRisk} />
          ))}
          {r.accounts > 3 && (
            <button
              type='button'
              className='text-muted-foreground text-xs hover:underline'
              onClick={() => toggle(r.ipAddress)}
            >
              +{r.accounts - 3} more
            </button>
          )}
        </span>
      )
    },
    { key: 'last', header: 'Last seen', cell: r => <DateTime value={r.lastSeen} /> }
  ]

  const expandedUsers = (r: SharedIpRow) =>
    open.has(r.ipAddress) ? (
      <div className='flex flex-col gap-2'>
        <p className='text-muted-foreground text-xs'>
          {r.accounts} accounts used {r.ipAddress} · first seen <DateTime value={r.firstSeen} />
          {r.users.length < r.accounts && ` · showing the ${r.users.length} most recent`}
        </p>
        <div className='grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3'>
          {r.users.map(u => (
            <div key={u.id} className='flex items-baseline justify-between gap-3'>
              <UserLink id={u.id} name={u.name} onRisk={openRisk} />
              <span className='text-muted-foreground text-xs whitespace-nowrap'>
                {u.logins} {u.logins === 1 ? 'login' : 'logins'} · <DateTime value={u.lastSeen} />
              </span>
            </div>
          ))}
        </div>
      </div>
    ) : null

  const active = tab === 'shared' ? shared : logins

  return (
    <div>
      <RiskManagementDialog userId={risk?.id ?? null} name={risk?.name} open={riskOpen} onOpenChange={setRiskOpen} />

      <Tabs value={tab} onValueChange={v => set({ tab: v === 'shared' || v === 'countries' ? v : '' })} className='mb-4'>
        <TabsList>
          <TabsTrigger value='logins'>All logins</TabsTrigger>
          <TabsTrigger value='shared'>Shared IPs</TabsTrigger>
          <TabsTrigger value='countries'>Countries</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === 'countries' && <GeoStats />}

      {tab !== 'countries' && (
        <>

      <div className='mb-4 flex flex-wrap items-center gap-3'>
        <div className='relative w-full sm:w-60'>
          <SearchIcon className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2' />
          <Input
            placeholder='User name, code or id'
            aria-label='User'
            value={search}
            onChange={e => setSearch(e.target.value)}
            className='pl-8'
          />
        </div>
        <Input
          placeholder='IP or 10.0.*'
          aria-label='IP address or prefix'
          value={ip}
          onChange={e => setIp(e.target.value)}
          className='w-full font-mono sm:w-48'
        />
        <Input
          placeholder='Country (IN or India)'
          aria-label='Country'
          value={country}
          onChange={e => setCountry(e.target.value)}
          className='w-full sm:w-44'
        />
        <Select value={String(state.source || ALL)} onValueChange={v => v && set({ source: v === ALL ? '' : v })}>
          <SelectTrigger className='w-36' aria-label='Event'>
            <SelectValue>
              {(v: string) => (v === ALL ? 'All events' : v === 'register' ? 'Sign-ups' : 'Logins')}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All events</SelectItem>
            <SelectItem value='login'>Logins</SelectItem>
            <SelectItem value='register'>Sign-ups</SelectItem>
          </SelectContent>
        </Select>
        <DateRangePicker
          aria-label='Date range'
          from={String(state.from ?? '')}
          to={String(state.to ?? '')}
          onChange={set}
        />
        <div className='flex items-center gap-2'>
          <Switch
            id='ipt-proxy'
            checked={state.proxyOnly === 'true'}
            onCheckedChange={checked => set({ proxyOnly: checked ? 'true' : '' })}
          />
          <Label htmlFor='ipt-proxy' className='text-sm font-normal'>
            VPN / proxy only
          </Label>
        </div>
        <Button variant='outline' onClick={reset} disabled={!filtered && !search && !ip && !country}>
          <RotateCcwIcon /> Reset
        </Button>
      </div>

      {tab === 'logins' ? (
        <DataTable
          columns={loginColumns}
          rows={logins.data?.rows}
          rowKey={r => r.id}
          loading={logins.isLoading}
          fetching={logins.isFetching}
          error={logins.error}
          pagination={logins.data?.pagination}
          onPageChange={page => set({ page })}
          onLimitChange={limit => set({ limit })}
          dense
          emptyMessage={filtered ? 'No logins match these filters.' : 'No logins recorded yet.'}
        />
      ) : (
        <DataTable
          columns={sharedColumns}
          rows={shared.data?.rows}
          rowKey={r => r.ipAddress}
          loading={shared.isLoading}
          fetching={shared.isFetching}
          error={shared.error}
          pagination={shared.data?.pagination}
          onPageChange={page => set({ page })}
          onLimitChange={limit => set({ limit })}
          onRowClick={r => toggle(r.ipAddress)}
          renderExpanded={expandedUsers}
          dense
          emptyMessage={
            filtered ? 'No shared IPs match these filters.' : 'No IP has been used by more than one account.'
          }
        />
      )}

      <div className='text-muted-foreground mt-3 space-y-1 text-xs'>
        {active.data?.rows.some(r => r.isPrivate) && (
          <p>Local addresses (127.0.0.1, 10.x, 192.168.x) never leave the server, so they are not geolocated.</p>
        )}
        <GeoAttribution className='' />
      </div>
        </>
      )}
    </div>
  )
}

/** IP tracker — Direct Users | Agent Users alag tab (dono ki listing alag). */
const IpTracker = () => (
  <div>
    <PageHeader
      title='Login & IP history'
      description='Where your users sign in from, and which addresses several accounts share. Only users in your own tree are shown.'
    />
    <ChannelTabs>{channel => <IpTrackerList channel={channel} />}</ChannelTabs>
  </div>
)

export default IpTracker
