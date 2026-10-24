'use client'

import ErrorState from '@/components/shared/ErrorState'
import StatCard from '@/components/shared/StatCard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useApi } from '@/hooks/use-api'
import { formatNumber } from '@/lib/format'
import { countryFlag } from './geo'
import type { GeoStats as GeoStatsData } from './types'

type Row = { key: string; label: string; cc?: string; value: number; extra?: string }

/** A ranked list with a proportional bar, in the theme's own colours. */
const Ranked = ({
  title,
  rows,
  total,
  loading,
  empty
}: {
  title: string
  rows: Row[]
  total: number
  loading: boolean
  empty: string
}) => (
  <Card className='shadow-none'>
    <CardHeader>
      <CardTitle className='text-sm'>{title}</CardTitle>
    </CardHeader>
    <CardContent>
      {loading ? (
        <p className='text-muted-foreground text-sm'>Loading…</p>
      ) : !rows.length ? (
        <p className='text-muted-foreground text-sm'>{empty}</p>
      ) : (
        <ul className='flex flex-col gap-2'>
          {rows.map(r => (
            <li key={r.key} className='text-sm'>
              <div className='flex items-baseline justify-between gap-2'>
                <span className='truncate'>
                  {countryFlag(r.cc)} {r.label}
                </span>
                <span className='tabular-nums'>
                  {formatNumber(r.value)}
                  {r.extra && <span className='text-muted-foreground ml-1 text-xs'>{r.extra}</span>}
                </span>
              </div>
              <div className='bg-muted mt-1 h-1.5 overflow-hidden rounded-full'>
                <div
                  className='bg-primary h-full rounded-full'
                  style={{ width: `${total ? Math.max(2, (r.value / total) * 100) : 0}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </CardContent>
  </Card>
)

/**
 * Where your players come from: the country and city they registered from (the sign-up lookup,
 * or their first located login for older and agent-created accounts) and the countries they log
 * in from. Every number counts players, not logins, and only players in your tree.
 */
const GeoStats = () => {
  const q = useApi<GeoStatsData>('admin/reports/geo-stats')

  if (q.error) return <ErrorState error={q.error} />
  const d = q.data
  const reg = d?.registration
  const loading = q.isLoading

  return (
    <div className='flex flex-col gap-4'>
      <div className='grid grid-cols-1 gap-4 sm:grid-cols-3'>
        <StatCard label='Players' loading={loading} value={formatNumber(d?.totalPlayers ?? 0)} />
        <StatCard
          label='Registration located'
          loading={loading}
          value={formatNumber(reg?.located ?? 0)}
          hint={
            reg
              ? `${reg.bySource.signup} at sign-up · ${reg.bySource.firstLogin} from first login · ${reg.unknown} unknown`
              : undefined
          }
        />
        <StatCard label='Players with a located login' loading={loading} value={formatNumber(d?.login.players ?? 0)} />
      </div>
      <div className='grid grid-cols-1 gap-4 lg:grid-cols-3'>
        <Ranked
          title='Registration country'
          loading={loading}
          total={reg?.located ?? 0}
          empty='No registration located yet.'
          rows={(reg?.countries ?? []).map(c => ({
            key: c.countryCode,
            label: c.country,
            cc: c.countryCode,
            value: c.players
          }))}
        />
        <Ranked
          title='Registration city'
          loading={loading}
          total={reg?.located ?? 0}
          empty='No city located yet.'
          rows={(reg?.cities ?? []).map(c => ({
            key: `${c.city}-${c.countryCode}`,
            label: `${c.city}, ${c.country}`,
            cc: c.countryCode,
            value: c.players
          }))}
        />
        <Ranked
          title='Login country'
          loading={loading}
          total={d?.login.players ?? 0}
          empty='No located logins yet.'
          rows={(d?.login.countries ?? []).map(c => ({
            key: c.countryCode,
            label: c.country,
            cc: c.countryCode,
            value: c.players,
            extra: `${formatNumber(c.logins)} logins`
          }))}
        />
      </div>
      <p className='text-muted-foreground text-xs'>
        Players, not logins: a player who signs in from two countries counts once in each. Local addresses are never
        located.
      </p>
    </div>
  )
}

export default GeoStats
