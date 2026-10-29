'use client'

import { useMemo } from 'react'


import { ArrowDownIcon, ArrowUpIcon, RefreshCwIcon } from 'lucide-react'

import {
  BarChart,
  ChartCard,
  DonutChart,
  FilterBar,
  KpiCard,
  TimeSeriesChart,
  categoryTable,
  fillBuckets,
  percentChange,
  seriesTable,
  toApiRange,
  useStatsFilters
} from '@/components/shared/charts'

import Can from '@/components/shared/Can'
import ChannelTabs, { type Channel } from '@/components/shared/ChannelTabs'
import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import { useDefaultCurrency } from '@/components/shared/DefaultCurrency'
import ErrorState from '@/components/shared/ErrorState'
import Money from '@/components/shared/Money'
import PageHeader from '@/components/shared/PageHeader'
import StatusBadge from '@/components/shared/StatusBadge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DateRangePicker } from '@/components/ui/date-picker'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useApi, useApiMutation, useListState } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { formatNumber } from '@/lib/format'
import { usePageList } from './usePageList'

/** Amounts are decimal strings on the wire. */
type Figures = { bets: number; paidWins: number; refunds: number; wagered: string; won: string; ggr: string; margin: number | null }

type Stats = {
  currency: string
  converted: boolean
  totals: Figures & { players: number; averageBet: string; winRate: number | null }
  series: (Figures & { bucket: string })[]
  byGame: (Figures & { code: string; name: string; players: number })[]
  byCurrency: { currency: string; bets: number; players: number; wagered: string; won: string; ggr: string }[]
  unconverted: { currency: string | null; amount: string; count: number }[]
}

type Bet = {
  id: string
  created_at: string
  userId: string
  username: string | null
  gameCode: string | null
  gameName: string | null
  currency: string
  stake: string
  payout: string | null
  profit: string | null
  settledAt: string | null
  roundId: string | null
  transactionId: string
  balanceAfter: string | null
  status: 'won' | 'lost' | 'open' | 'refunded'
}

type Game = {
  code: string
  name: string
  status: string | null
  enabled: boolean
  rtp: number | null
  category: string | null
  currencies: string[]
  limits: { currency: string; minBet: string | null; maxBet: string | null; maxWin: string | null }[]
  image: string | null
  syncedAt: string | null
  bets: number
  players: number
  lastBetAt: string | null
}

type Games = { switches: { owner: boolean; site: boolean; live: boolean }; games: Game[] }

const BASE = 'admin/original-games'
const ALL = '__all__'
const STATUSES = ['won', 'lost', 'open', 'refunded'] as const

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(2)}%`)

// ── Dashboard ──────────────────────────────────────────────────────────

/** `turnover` shows the turnover pieces (by game, by coin); otherwise the dashboard (KPIs, trend charts). One stats fetch serves both. */
const DashboardTab = ({ channel, turnover = false }: { channel: Channel; turnover?: boolean }) => {
  const filters = useStatsFilters()
  const reportCoin = useDefaultCurrency().code
  const query = { channel, ...filters.query }
  const stats = useApi<Stats>(`${BASE}/stats`, query)
  const prev = useApi<Stats>(`${BASE}/stats`, { ...query, ...filters.previous.apiRange })

  const s = stats.data
  const t = s?.totals
  const p = prev.data?.totals
  const currency = s?.currency ?? reportCoin
  const loading = stats.isLoading

  const charts = useMemo(() => {
    const pick = (f: (r: Stats['series'][number]) => string | number | null) => fillBuckets(filters.buckets, s?.series ?? [], r => r.bucket, f)
    const games = s?.byGame ?? []

    return {
      money: [
        { name: 'Wagered', data: pick(r => r.wagered), color: 'chart-1' as const },
        { name: 'Won (paid out)', data: pick(r => r.won), color: 'chart-2' as const },
        { name: 'GGR', data: pick(r => r.ggr), color: 'primary' as const, kind: 'line' as const }
      ],
      bets: [{ name: 'Bets', data: pick(r => r.bets) }],
      games
    }
  }, [s, filters.buckets])

  const delta = (cur?: string | number | null, before?: string | number | null) =>
    p && cur != null && before != null ? percentChange(Number(cur), Number(before)) : null

  const gameColumns: Column<Stats['byGame'][number]>[] = [
    { key: 'name', header: 'Game', cell: r => <span className='font-medium'>{r.name}</span> },
    { key: 'players', header: 'Players', align: 'right', cell: r => <span className='tabular-nums'>{formatNumber(r.players)}</span> },
    { key: 'bets', header: 'Bets', align: 'right', cell: r => <span className='tabular-nums'>{formatNumber(r.bets)}</span> },
    { key: 'wagered', header: 'Wagered', align: 'right', cell: r => <Money value={r.wagered} currency={currency} /> },
    { key: 'won', header: 'Won', align: 'right', cell: r => <Money value={r.won} currency={currency} /> },
    { key: 'ggr', header: 'GGR', align: 'right', cell: r => <Money value={r.ggr} currency={currency} signed /> },
    { key: 'margin', header: 'Margin', align: 'right', cell: r => <span className='tabular-nums'>{pct(r.margin)}</span> }
  ]

  return (
    <div>
      <FilterBar filters={filters} className='mb-4' />

      {s && s.unconverted.length > 0 && (
        <Alert className='mb-4'>
          <AlertDescription>
            Not in the {currency} totals (no exchange rate): {s.unconverted.map(u => u.currency ?? 'unknown').join(', ')}.
          </AlertDescription>
        </Alert>
      )}

      {!turnover && (
        <>
      <div className='mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4'>
        <KpiCard
          label='Wagered'
          value={<Money value={t?.wagered} currency={currency} />}
          loading={loading}
          delta={delta(t?.wagered, p?.wagered)}
          hint={
            <>
              {formatNumber(t?.bets)} bets · avg <Money value={t?.averageBet} currency={currency} />
            </>
          }
          spark={charts.money[0].data}
          sparkFormat='money'
          sparkCurrency={currency}
        />
        <KpiCard
          label='Won by players'
          value={<Money value={t?.won} currency={currency} />}
          loading={loading}
          delta={delta(t?.won, p?.won)}
          goodWhen='neutral'
          hint={`${formatNumber(t?.paidWins)} paid wins · win rate ${pct(t?.winRate)}`}
        />
        <KpiCard
          label='GGR (house)'
          value={<Money value={t?.ggr} currency={currency} signed />}
          loading={loading}
          delta={delta(t?.ggr, p?.ggr)}
          hint={`Margin ${pct(t?.margin)}`}
          spark={charts.money[2].data}
          sparkColor='primary'
          sparkFormat='money'
          sparkCurrency={currency}
        />
        <KpiCard
          label='Players'
          value={formatNumber(t?.players)}
          loading={loading}
          delta={delta(t?.players, p?.players)}
          hint={`${formatNumber(t?.refunds)} refunded bets`}
        />
      </div>


        <ChartCard
          className='mb-4'
          title='Wagered vs won vs GGR'
          description={`Per ${filters.granularity}, ${currency}${s?.converted ? ' (converted at current rates)' : ''}`}
          table={seriesTable({ buckets: filters.buckets, granularity: filters.granularity, series: charts.money, format: 'money', currency })}
        >
          <TimeSeriesChart
            ariaLabel={`Original games wagered, won and GGR per ${filters.granularity}, ${currency}`}
            buckets={filters.buckets}
            granularity={filters.granularity}
            series={charts.money}
            kind='bar'
            format='money'
            currency={currency}
            loading={loading}
            error={stats.error}
            emptyMessage='No bets in this period.'
          />
        </ChartCard>

      <div className='mb-4 grid grid-cols-1 gap-4 xl:grid-cols-3'>
        <ChartCard
          className='xl:col-span-2'
          title='Bets placed'
          description={`Count per ${filters.granularity}`}
          table={seriesTable({ buckets: filters.buckets, granularity: filters.granularity, series: charts.bets })}
        >
          <TimeSeriesChart
            ariaLabel={`Original games bets per ${filters.granularity}`}
            buckets={filters.buckets}
            granularity={filters.granularity}
            series={charts.bets}
            kind='area'
            loading={loading}
            error={stats.error}
            emptyMessage='No bets in this period.'
          />
        </ChartCard>
        <ChartCard title='GGR by game' description={currency}>
          <BarChart
            ariaLabel={`Original games GGR by game, ${currency}`}
            categories={charts.games.map(g => g.name)}
            series={[{ name: 'GGR', data: charts.games.map(g => Number(g.ggr)) }]}
            horizontal
            format='money'
            currency={currency}
            loading={loading}
            error={stats.error}
            emptyMessage='Nothing to compare.'
          />
        </ChartCard>
      </div>
        </>
      )}

      {turnover && (
        <>
      <div className='mb-4'>
        <ChartCard
          title='Wagered by game'
          description={`Share of turnover, ${currency}`}
          table={categoryTable({
            categories: charts.games.map(g => g.name),
            categoryHeader: 'Game',
            series: [
              { name: 'Bets', data: charts.games.map(g => g.bets) },
              { name: `Wagered (${currency})`, data: charts.games.map(g => Number(g.wagered)) }
            ]
          })}
        >
          <DonutChart
            ariaLabel={`Original games turnover by game, ${currency}`}
            labels={charts.games.map(g => g.name)}
            values={charts.games.map(g => Number(g.wagered))}
            totalLabel='Wagered'
            format='money'
            currency={currency}
            loading={loading}
            error={stats.error}
            emptyMessage='Nothing wagered in this period.'
          />
        </ChartCard>
      </div>

      {/* Each coin as it really turned over — no conversion. */}
      <div className='mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2'>
        {(s?.byCurrency ?? []).map(c => (
          <Card key={c.currency} className='shadow-none'>
            <CardHeader className='pb-2'>
              <CardTitle className='flex items-center gap-2 text-base'>
                <Badge variant='outline'>{c.currency}</Badge>
                <span className='text-muted-foreground text-sm font-normal'>
                  {formatNumber(c.bets)} bets · {formatNumber(c.players)} players
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className='grid grid-cols-3 gap-2 text-sm'>
              <div>
                <div className='text-muted-foreground text-xs'>Wagered</div>
                <Money value={c.wagered} currency={c.currency} />
              </div>
              <div>
                <div className='text-muted-foreground text-xs'>Won</div>
                <Money value={c.won} currency={c.currency} />
              </div>
              <div>
                <div className='text-muted-foreground text-xs'>GGR</div>
                <Money value={c.ggr} currency={c.currency} signed />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <h2 className='mb-2 text-sm font-medium'>Games by turnover</h2>
      <DataTable columns={gameColumns} rows={s?.byGame} rowKey={r => r.code} loading={loading} error={stats.error} emptyMessage='No bets in this period.' />
        </>
      )}
    </div>
  )
}

// ── Bet history ────────────────────────────────────────────────────────

const betColumns: Column<Bet>[] = [
  { key: 'at', header: 'Time', cell: r => <DateTime value={r.created_at} /> },
  {
    key: 'user',
    header: 'User',
    cell: r => (
      <div>
        <div>{r.username ?? '—'}</div>
        <div className='text-muted-foreground font-mono text-xs'>#{r.userId}</div>
      </div>
    )
  },
  { key: 'game', header: 'Game', cell: r => <span className='font-medium'>{r.gameName ?? '—'}</span> },
  { key: 'stake', header: 'Bet', align: 'right', cell: r => <Money value={r.stake} currency={r.currency} /> },
  { key: 'payout', header: 'Payout', align: 'right', cell: r => (r.payout == null ? <span className='text-muted-foreground'>—</span> : <Money value={r.payout} currency={r.currency} />) },
  { key: 'profit', header: 'Player P/L', align: 'right', cell: r => (r.profit == null ? <span className='text-muted-foreground'>—</span> : <Money value={r.profit} currency={r.currency} signed />) },
  { key: 'status', header: 'Result', cell: r => <StatusBadge value={r.status} /> },
  { key: 'balance', header: 'Balance after', align: 'right', cell: r => <Money value={r.balanceAfter} currency={r.currency} /> },
  {
    key: 'ref',
    header: 'Round / txn',
    cell: r => (
      <div className='font-mono text-xs'>
        <div>{r.roundId ?? '—'}</div>
        <div className='text-muted-foreground'>{r.transactionId}</div>
      </div>
    )
  }
]

const FilterSelect = ({ value, onChange, all, options }: { value: string; onChange: (v: string) => void; all: string; options: { value: string; label: string }[] }) => (
  <Select value={value || ALL} onValueChange={v => v && onChange(v === ALL ? '' : v)}>
    <SelectTrigger className='w-36'>
      <SelectValue>{(v: string) => (v === ALL ? all : (options.find(o => o.value === v)?.label ?? v))}</SelectValue>
    </SelectTrigger>
    <SelectContent>
      <SelectItem value={ALL}>{all}</SelectItem>
      {options.map(o => (
        <SelectItem key={o.value} value={o.value}>
          {o.label}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
)

const BetsTab = ({ channel }: { channel: Channel }) => {
  const { state, set } = useListState(['game', 'status', 'from', 'to'])
  const games = useApi<Games>(`${BASE}/games`, { channel })

  // The picker's `to` is the last day shown, so the window ends at the start of the next day.
  const range = state.from && state.to ? toApiRange(String(state.from), String(state.to)) : {}

  const list = usePageList<Bet>(`${BASE}/bets`, {
    channel,
    page: state.page,
    limit: state.limit,
    search: state.search || undefined,
    game: state.game || undefined,
    status: state.status || undefined,
    ...range
  })

  return (
    <DataTable
      columns={betColumns}
      rows={list.data?.rows}
      rowKey={r => r.id}
      loading={list.isLoading}
      fetching={list.isFetching}
      error={list.error}
      pagination={list.data?.pagination}
      onPageChange={page => set({ page })}
      onLimitChange={limit => set({ limit })}
      search={String(state.search ?? '')}
      onSearchChange={search => set({ search })}
      searchPlaceholder='Username, user id, round or txn id…'
      dense
      emptyMessage='No bets match.'
      toolbar={
        <>
          <FilterSelect value={String(state.game ?? '')} onChange={game => set({ game })} all='All games' options={(games.data?.games ?? []).map(g => ({ value: g.code, label: g.name }))} />
          <FilterSelect value={String(state.status ?? '')} onChange={status => set({ status })} all='All results' options={STATUSES.map(s => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))} />
          <DateRangePicker aria-label='Date range' from={String(state.from ?? '')} to={String(state.to ?? '')} onChange={set} />
        </>
      }
    />
  )
}

// ── Games (what the provider offers, and its status) ─────────────────────

/** rainbet: the casino-service routes that change the catalogue (on/off, order, sync). */
const CASINO = 'admin/casino/original-games/games'

const GameCard = ({ game, onToggle, onMove, busy, first, last }: { game: Game; onToggle: (on: boolean) => void; onMove: (by: -1 | 1) => void; busy: boolean; first: boolean; last: boolean }) => (
  <Card className='shadow-none'>
    <CardHeader className='pb-2'>
      <div className='flex items-start justify-between gap-2'>
        <div className='flex items-start gap-3'>
          {game.image && <img src={game.image} alt='' className='bg-muted size-12 rounded object-cover' />}
          <div>
            <CardTitle className='text-base'>{game.name}</CardTitle>
            <div className='text-muted-foreground font-mono text-xs'>{game.code}</div>
          </div>
        </div>
        <div className='flex flex-col items-end gap-1'>
          <StatusBadge value={game.status ?? 'unknown'} />
          {!game.enabled && <StatusBadge value='disabled' />}
        </div>
      </div>
      <Can permission='config:write'>
        <div className='flex items-center justify-between gap-2 pt-2'>
          <label className='flex items-center gap-2 text-sm'>
            <Switch checked={game.enabled} disabled={busy} onCheckedChange={onToggle} />
            On the site
          </label>
          <div className='flex gap-1'>
            <Button variant='ghost' size='icon' aria-label='Move up' disabled={busy || first} onClick={() => onMove(-1)}>
              <ArrowUpIcon />
            </Button>
            <Button variant='ghost' size='icon' aria-label='Move down' disabled={busy || last} onClick={() => onMove(1)}>
              <ArrowDownIcon />
            </Button>
          </div>
        </div>
      </Can>
    </CardHeader>
    <CardContent className='grid gap-3 text-sm'>
      <div className='grid grid-cols-3 gap-2'>
        <div>
          <div className='text-muted-foreground text-xs'>RTP</div>
          <div className='tabular-nums'>{game.rtp == null ? '—' : `${(game.rtp * 100).toFixed(2)}%`}</div>
        </div>
        <div>
          <div className='text-muted-foreground text-xs'>Bets</div>
          <div className='tabular-nums'>{formatNumber(game.bets)}</div>
        </div>
        <div>
          <div className='text-muted-foreground text-xs'>Players</div>
          <div className='tabular-nums'>{formatNumber(game.players)}</div>
        </div>
      </div>
      <div className='grid gap-1'>
        {game.limits.map(l => (
          <div key={l.currency} className='flex flex-wrap items-center gap-x-2 text-xs'>
            <Badge variant='outline'>{l.currency}</Badge>
            <span className='text-muted-foreground'>min</span>
            <Money value={l.minBet} currency={l.currency} />
            <span className='text-muted-foreground'>max</span>
            <Money value={l.maxBet} currency={l.currency} />
          </div>
        ))}
      </div>
      <div className='text-muted-foreground flex flex-wrap justify-between gap-2 text-xs'>
        <span>Last bet: {game.lastBetAt ? <DateTime value={game.lastBetAt} /> : 'never'}</span>
        <span>Synced: {game.syncedAt ? <DateTime value={game.syncedAt} /> : '—'}</span>
      </div>
    </CardContent>
  </Card>
)

// No Direct/Agent tabs here: the catalogue is the same for both, so last-bet figures cover every player.
const GamesTab = () => {
  const q = useApi<Games>(`${BASE}/games`)

  // rainbet: the player site's Originals follow this list — on/off, order (top first) and a sync.
  const invalidate = [['api', `${BASE}/games`]]

  const toggle = useApiMutation({
    fn: (v: { code: string; enabled: boolean }) => api.put(`${CASINO}/${encodeURIComponent(v.code)}`, { enabled: v.enabled }),
    invalidate,
    success: (_r, v) => (v.enabled ? 'Shown on the site' : 'Hidden from the site')
  })

  const order = useApiMutation({ fn: (codes: string[]) => api.put(`${CASINO}/order`, { codes }), invalidate, success: 'Order saved' })
  const sync = useApiMutation({ fn: () => api.post(`${CASINO}/sync`), invalidate, success: 'Games synced from the provider' })
  const busy = toggle.isPending || order.isPending || sync.isPending

  if (q.error) return <ErrorState error={q.error} />
  const games = q.data?.games ?? []
  const live = games.filter(g => g.enabled && g.status === 'live').length

  const move = (at: number, by: -1 | 1) => {
    const codes = games.map(g => g.code)

    ;[codes[at], codes[at + by]] = [codes[at + by], codes[at]]
    order.mutate(codes)
  }

  return (
    <div className='grid gap-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='text-muted-foreground text-sm'>
          {formatNumber(games.length)} games from the provider · {formatNumber(live)} live. Play counts are for all players, all time. The site shows the
          games that are on, in this order.
        </div>
        <Can permission='config:write'>
          <Button variant='outline' size='sm' disabled={busy} onClick={() => sync.mutate()}>
            <RefreshCwIcon /> {sync.isPending ? 'Syncing…' : 'Sync games'}
          </Button>
        </Can>
      </div>
      {q.isLoading ? (
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className='h-48' />
          ))}
        </div>
      ) : games.length ? (
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'>
          {games.map((g, i) => (
            <GameCard
              key={g.code}
              game={g}
              busy={busy}
              first={i === 0}
              last={i === games.length - 1}
              onToggle={enabled => toggle.mutate({ code: g.code, enabled })}
              onMove={by => move(i, by)}
            />
          ))}
        </div>
      ) : (
        <Alert>
          <AlertDescription>No games synced yet. Press Sync games (needs the provider keys on the backend).</AlertDescription>
        </Alert>
      )}
    </div>
  )
}

const SECTIONS = {
  dashboard: { title: 'Original Games · Dashboard', description: 'Payouts and GGR (wagered − won) of the Original Games Aggregator. Refunded (rolled back) bets are kept out of the figures.', Tab: DashboardTab },
  turnover: { title: 'Original Games · Turnover', description: 'What was wagered: by game, and by coin as it really turned over. Refunded (rolled back) bets are kept out.', Tab: ({ channel }: { channel: Channel }) => <DashboardTab channel={channel} turnover /> },
  bets: { title: 'Original Games · Bet history', description: 'Every Original Games round: bet, payout, result and balance after.', Tab: BetsTab },
  games: { title: 'Original Games · Games', description: 'The games the provider offers, their limits and status.', Tab: GamesTab }
}

/** Admin → Original Games → Dashboard / Bet history / Games. Super Admin and its executives with `originals:read`. */
const OriginalGames = ({ section = 'dashboard' }: { section?: keyof typeof SECTIONS }) => {
  const { title, description, Tab } = SECTIONS[section]

  return (
    <div>
      <PageHeader title={title} description={description} />
      {section === 'games' ? <GamesTab /> : <ChannelTabs>{channel => <Tab channel={channel} />}</ChannelTabs>}
    </div>
  )
}

export default OriginalGames
