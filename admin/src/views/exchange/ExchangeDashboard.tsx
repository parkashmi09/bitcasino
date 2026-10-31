'use client'

import type { ReactNode } from 'react'

import {
  ArrowDownToLineIcon,
  ArrowUpFromLineIcon,
  CreditCardIcon,
  HandCoinsIcon,
  LayersIcon,
  MinusIcon,
  ShieldAlertIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  WalletIcon
} from 'lucide-react'

import { BarChart, ChartCard, type ChartTableData } from '@/components/shared/charts'
import ErrorState from '@/components/shared/ErrorState'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useApi } from '@/hooks/use-api'
import { cn } from '@/lib/utils'

/** `GET admin/exchange/user-reports/home` — login wale ka apna credits row. */
type Home = {
  balance: string
  exposure: string
  credit: string
  allPoint: string
  settlementPoints: string
  upperPoint: string
  downPoint: string
  sportsPts: string
  casinoPts: string
  originalPts: string
  isOwner: boolean
}

type Item = { label: string; value: number }

/** Zip ka fmt — Number(val).toLocaleString(). */
const fmt = (value: number) => Number(value || 0).toLocaleString()

/** P/L me sign hamesha dikhe: +1,200 / −300. */
const fmtSigned = (value: number) => (value > 0 ? `+${fmt(value)}` : value < 0 ? `−${fmt(Math.abs(value))}` : '0')

/** Wallet ke *_pts downline ka mirror hain — zip upline ki nazar se dikhata hai (negate). -0 se bacho. */
const negPL = (value: string | undefined) => {
  const n = Number(value) || 0

  return n === 0 ? 0 : -n
}

/** Chart ke numbers table me — Chart/Table toggle ke liye. */
const toTable = (items: Item[], format: (v: number) => string): ChartTableData => ({
  columns: [{ header: 'Name' }, { header: 'Value', align: 'right' }],
  rows: items.map(i => [i.label, format(i.value)])
})

/**
 * Points — simple bars. Upar bada All Pts, neeche har point ki ek moti bar (sabse bada = poori).
 * Plus wali primary rang me, minus wali laal; value aur % bar ke upar likhe hain.
 */
const PointsBars = ({ items, centre }: { items: Item[]; centre: Item }) => {
  return (
    <div className='flex flex-col gap-6'>
      <div className='from-primary/15 to-primary/5 border-primary/20 flex items-center justify-between gap-4 rounded-xl border bg-gradient-to-r px-4 py-3'>
        <div className='min-w-0'>
          <p className='text-muted-foreground text-xs'>{centre.label}</p>
          <p className='text-foreground text-3xl font-semibold tracking-tight tabular-nums'>{fmt(centre.value)}</p>
        </div>
        <span className='bg-primary/15 text-primary rounded-full px-3 py-1 text-xs font-medium'>
          {items.filter(i => i.value !== 0).length} / {items.length} active
        </span>
      </div>

      <BarChart
        ariaLabel='Points by type'
        height={300}
        stacked
        categories={items.map(i => i.label)}
        series={[
          { name: 'Points', data: items.map(i => (i.value >= 0 ? i.value : null)), color: 'chart-1' },
          ...(items.some(i => i.value < 0) ? [{ name: 'Negative', data: items.map(i => (i.value < 0 ? i.value : null)), color: 'danger' as const }] : [])
        ]}
      />
    </div>
  )
}

/** Plus = success, minus = danger, 0 = muted — P/L ka matlab, sajawat nahi. */
const plTone = (v: number) => (v > 0 ? 'success' : v < 0 ? 'danger' : 'muted-foreground')

/**
 * P/L — upar bada Total P/L (trend icon ke saath), neeche har P/L ki bar beech ki zero line se:
 * profit right (hara), loss left (laal), gradient ke saath.
 */
const PLPanel = ({ items, total }: { items: Item[]; total: number }) => {
  const tone = plTone(total)
  const Icon = total > 0 ? TrendingUpIcon : total < 0 ? TrendingDownIcon : MinusIcon

  return (
    <div className='flex flex-col gap-6'>
      <div className='flex items-center gap-4'>
        <span
          className={cn(
            'flex size-12 shrink-0 items-center justify-center rounded-xl',
            tone === 'success' && 'bg-success-soft text-success',
            tone === 'danger' && 'bg-danger-soft text-danger',
            tone === 'muted-foreground' && 'bg-muted text-muted-foreground'
          )}
        >
          <Icon className='size-6' />
        </span>
        <div className='min-w-0'>
          <p className='text-muted-foreground text-xs'>Total P/L</p>
          <p className='text-foreground text-3xl font-semibold tracking-tight tabular-nums'>{fmtSigned(total)}</p>
          <p className='text-muted-foreground text-xs'>{total > 0 ? 'In profit' : total < 0 ? 'In loss' : 'Break-even'}</p>
        </div>
      </div>

      <BarChart
        ariaLabel='Profit and loss by source'
        height={260}
        horizontal
        stacked
        categories={items.map(i => i.label)}
        series={[
          { name: 'Profit', data: items.map(i => (i.value > 0 ? i.value : null)), color: 'success' },
          { name: 'Loss', data: items.map(i => (i.value < 0 ? i.value : null)), color: 'danger' }
        ]}
      />
    </div>
  )
}

/** One figure: an icon chip, the label, the value (red below zero), and a thin accent line. */
const Tile = ({ label, value, icon, hint, loading }: { label: string; value: number; icon: ReactNode; hint: string; loading: boolean }) => (
  <Card className='group relative gap-0 overflow-hidden py-4 shadow-none transition-colors hover:border-primary/30'>
    <span aria-hidden className={cn('absolute inset-x-0 top-0 h-0.5', value < 0 ? 'bg-danger/60' : 'bg-primary/40')} />
    <CardContent className='flex items-center gap-3 px-4'>
      <span
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-xl [&_svg]:size-5',
          value < 0 ? 'bg-danger-soft text-danger' : 'bg-primary/10 text-primary'
        )}
      >
        {icon}
      </span>
      <div className='min-w-0'>
        <p className='text-muted-foreground text-xs font-medium'>{label}</p>
        {loading ? (
          <Skeleton className='mt-1.5 h-7 w-20' />
        ) : (
          <p className={cn('truncate text-2xl font-semibold tracking-tight tabular-nums', value < 0 && 'text-danger')}>{fmt(value)}</p>
        )}
        <p className='text-muted-foreground truncate text-[11px]'>{hint}</p>
      </div>
    </CardContent>
  </Card>
)

const PanelSkeleton = () => (
  <div className='flex flex-col gap-4'>
    <Skeleton className='h-16 w-full rounded-xl' />
    {Array.from({ length: 5 }).map((_, i) => (
      <Skeleton key={i} className='h-8 w-full' />
    ))}
  </div>
)

/**
 * Dashboard ka "Agent System" tab (Sports Exchange) — zip ka `pages/Home.jsx`.
 *
 * Upar 7 cards (Balance, Exposure, Credit / All / Settlement / Upper / Down pts),
 * phir do panel: points (bars) aur P/L. Saare points 0 hon to points wala nahi
 * dikhta; P/L tab hi chhupta hai jab points aur P/L dono 0 hon (zip jaisa).
 * P/L = Sports + Third Party (casino) + Original games, agent ke apne credits row se.
 */
const ExchangeDashboard = () => {
  const { data, isLoading, error } = useApi<Home>('admin/exchange/user-reports/home')

  const creditPts = Number(data?.credit) || 0
  const allPts = Number(data?.allPoint) || 0
  const settlementPts = Number(data?.settlementPoints) || 0
  const upperPts = Number(data?.upperPoint) || 0
  const downPts = Number(data?.downPoint) || 0

  const sportsPL = negPL(data?.sportsPts)
  const casinoPL = negPL(data?.casinoPts)
  const originalPL = negPL(data?.originalPts)
  const totalPL = Math.round((sportsPL + casinoPL + originalPL) * 100) / 100

  const points: Item[] = [
    { label: 'Credit Pts', value: creditPts },
    { label: 'All Pts', value: allPts },
    { label: 'Settlement Pts', value: settlementPts },
    { label: 'Upper Pts', value: upperPts },
    { label: 'Down Pts', value: downPts }
  ]

  const pl: Item[] = [
    { label: 'Sports P/L', value: sportsPL },
    { label: 'Third Party P/L', value: casinoPL },
    { label: 'Original P/L', value: originalPL },
    { label: 'Total P/L', value: totalPL }
  ]

  const hasPoints = points.some(i => i.value !== 0)
  const hasPL = hasPoints || pl.some(i => i.value !== 0)

  // Exposure API se positive aata hai, card pe loss (-) dikhta hai.
  const exposure = -Math.abs(Number(data?.exposure) || 0) || 0

  const wallet = [
    { label: 'Balance', value: Number(data?.balance) || 0, icon: <WalletIcon />, hint: 'Your own balance' },
    { label: 'Exposure', value: exposure, icon: <ShieldAlertIcon />, hint: 'Held in open bets' },
    { label: 'Credit pts', value: creditPts, icon: <CreditCardIcon />, hint: 'Credit given to you' },
    { label: 'All pts', value: allPts, icon: <LayersIcon />, hint: 'Across your tree' }
  ]

  const settle = [
    { label: 'Settlement pts', value: settlementPts, icon: <HandCoinsIcon />, hint: 'Still to settle' },
    { label: 'Upper pts', value: upperPts, icon: <ArrowUpFromLineIcon />, hint: 'With your upline' },
    { label: 'Down pts', value: downPts, icon: <ArrowDownToLineIcon />, hint: 'With your downline' }
  ]

  const showPoints = isLoading || hasPoints
  const showPL = isLoading || hasPL

  return (
    <div className='flex flex-col gap-4'>
      {error && !data && <ErrorState error={error} title='Could not load your points' />}
      <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4'>
        {wallet.map(t => (
          <Tile key={t.label} {...t} loading={isLoading} />
        ))}
      </div>
      <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
        {settle.map(t => (
          <Tile key={t.label} {...t} loading={isLoading} />
        ))}
      </div>

      {(showPoints || showPL) && (
        <div className='grid gap-4 xl:grid-cols-5'>
          {showPoints && (
            <ChartCard
              className={cn(showPL ? 'xl:col-span-3' : 'xl:col-span-5')}
              title='Points overview'
              description='Each column is one point type — hover for the exact value.'
              table={toTable(points, fmt)}
            >
              {isLoading ? <PanelSkeleton /> : <PointsBars items={points} centre={points[1]} />}
            </ChartCard>
          )}

          {showPL && (
            <ChartCard
              className={cn(showPoints ? 'xl:col-span-2' : 'xl:col-span-5')}
              title='P/L overview'
              description='Profit in green to the right of zero, loss in red to the left.'
              table={toTable(pl, fmtSigned)}
            >
              {isLoading ? <PanelSkeleton /> : <PLPanel items={pl} total={totalPL} />}
            </ChartCard>
          )}
        </div>
      )}
    </div>
  )
}

export default ExchangeDashboard
