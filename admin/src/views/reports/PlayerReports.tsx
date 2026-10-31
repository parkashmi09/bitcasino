'use client'

import { useState } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { DownloadIcon, FileTextIcon, SearchIcon } from 'lucide-react'
import { parseAsString, useQueryState } from 'nuqs'
import { toast } from 'sonner'

import DataTable, { type Column } from '@/components/shared/DataTable'
import FormDialog from '@/components/shared/FormDialog'
import { DateRangeField, TextField } from '@/components/shared/FormField'
import Money from '@/components/shared/Money'
import PageHeader from '@/components/shared/PageHeader'
import StatusBadge from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSession } from '@/contexts/SessionContext'
import { useListState, usePagedApi } from '@/hooks/use-api'
import { api, errorMessage } from '@/lib/api/client'
import { check } from '@/lib/validate'
import { formatNumber } from '@/lib/format'
import PlayerStatsOverview from './PlayerStatsOverview'
import { daysAgo, downloadBlob, type PlayerReportRow } from './types'

const playerColumns: Column<PlayerReportRow>[] = [
  {
    key: 'user',
    header: 'User',
    cell: r => (
      <div className='flex flex-col'>
        <Link href={`/users/${r.id}`} className='font-medium hover:underline' onClick={e => e.stopPropagation()}>
          {r.name}
        </Link>
        <span className='text-muted-foreground font-mono text-xs'>#{r.id}{r.referralCode ? ` · ${r.referralCode}` : ''}</span>
      </div>
    )
  },
  { key: 'status', header: 'Status', cell: r => <StatusBadge value={r.status} /> },

  // Lifetime wager (userwager) in the currency the API reports for it; the report has no currency
  // field yet and userwager is kept in USD, so USD until it sends one.
  { key: 'wager', header: 'Wager', align: 'right', cell: r => <Money value={r.wager} currency={r.wagerCurrency ?? 'USD'} digits={2} /> },
  {
    key: 'vip',
    header: 'VIP',
    cell: r => (
      <span className='text-sm'>
        L{r.vip?.level}{' '}
        <span className='text-muted-foreground'>
          {r.vip?.card} · {r.vip?.nextLevel == null ? 'Top level' : `${r.vip.progressPct}% to L${r.vip.nextLevel}`}
        </span>
      </span>
    )
  },

  // `balance` is the INR wallet (credits.inr); deposits and withdrawals are valued in INR.
  { key: 'balance', header: <span title='The INR wallet'>Balance</span>, align: 'right', cell: r => <Money value={r.balance} currency='INR' /> },
  {
    key: 'dep',
    header: <span title='Lifetime real deposits the player paid in (bank, gateway, crypto, every coin), valued in INR. Admin credits are not deposits.'>Deposits</span>,
    align: 'right',
    cell: r => <Money value={r.totalDeposited} currency='INR' />
  },
  { key: 'wd', header: 'Withdrawn', align: 'right', cell: r => <Money value={r.totalWithdrawn} currency='INR' /> },
  { key: 'games', header: <span title='Lifetime bets, every product (stakes on the wallet ledger).'>Bets</span>, align: 'right', cell: r => formatNumber(r.gamesPlayed) }
]

const PlayersTab = ({ withStats }: { withStats: boolean }) => {
  // Sirf direct users (bina parent) — agent ke clients Sports Exchange me hain.
  // Agent-tree logins see no promotions: the VIP column goes with them.
  const promotions = useSession().actor?.promotions === true
  const router = useRouter()
  const { state, set, query } = useListState()
  const list = usePagedApi<PlayerReportRow>('admin/reports/players', { limit: query.limit, page: query.page, search: query.search, channel: 'direct' })
  const [exporting, setExporting] = useState(false)

  const exportCsv = async () => {
    setExporting(true)

    try {
      const blob = await api.blob('admin/reports/players/export', { channel: 'direct', search: query.search })

      downloadBlob(blob, `users-${daysAgo(0)}.csv`)
      toast.success('Export downloaded (the platform audits this)')
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
    {withStats && <PlayerStatsOverview channel='direct' />}
    <DataTable
      columns={promotions ? playerColumns : playerColumns.filter(c => c.key !== 'vip')}
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
      searchPlaceholder='Username or referral code…'
      onRowClick={r => router.push(`/users/${r.id}`)}
      toolbar={
        <>
          <Button variant='outline' className='ml-auto' onClick={exportCsv} disabled={exporting}>
            <DownloadIcon /> Export CSV
          </Button>
        </>
      }
    />
    </>
  )
}

const PlayerLookup = () => {
  const router = useRouter()
  const [id, setId] = useState('')

  return (
    <form
      className='flex items-center gap-2'
      onSubmit={e => {
        e.preventDefault()
        if (id.trim()) router.push(`/users/${id.trim()}`)
      }}
    >
      <Input placeholder='User id' className='w-40' value={id} onChange={e => setId(e.target.value.replace(/\D/g, ''))} />
      <Button type='submit' variant='outline' disabled={!id}>
        <SearchIcon /> Open user
      </Button>
    </form>
  )
}

const PlayerSheet = () => {
  const [form, setForm] = useState({ uid: '', from: daysAgo(30), to: daysAgo(0) })

  return (
    <FormDialog
      trigger={
        <Button variant='outline'>
          <FileTextIcon /> User sheet PDF
        </Button>
      }
      title='Download a user sheet'
      description='A printable statement of one user for the period.'
      submitLabel='Download'
      validate={() => ({
        'ps-uid': check.id(form.uid, 'User id'),
        'ps-period': check.dateRange(form.from, form.to, 'The period must start before it ends')
      })}
      onSubmit={async () => {
        // A failure is toasted by the dialog (with the server's message) and the dialog stays open.
        const blob = await api.blob(`admin/reports/player-sheet/${form.uid.trim()}`, { from: form.from || undefined, to: form.to || undefined })

        downloadBlob(blob, `user-${form.uid.trim()}-${form.from}-${form.to}.pdf`)
        toast.success('User sheet downloaded')
      }}
    >
      <TextField id='ps-uid' inputMode='numeric' label='User id' required value={form.uid} onChange={e => setForm({ ...form, uid: e.target.value.replace(/\D/g, '') })} />
      <DateRangeField id='ps-period' label='Period' from={form.from} to={form.to} onChange={r => setForm({ ...form, ...r })} />
    </FormDialog>
  )
}

const PlayerReports = () => {
  const promotions = useSession().actor?.promotions === true
  const [tab, setTab] = useQueryState('tab', parseAsString.withDefault('overview').withOptions({ history: 'replace', scroll: false }))

  return (
    <div>
      <PageHeader
        title='User reports'
        description={`Wager, ${promotions ? 'VIP progress ' : ''}and money per user; CSV export and printable user sheets.`}
        actions={
          <>
            <PlayerLookup />
            <PlayerSheet />
          </>
        }
      />
      {/* The list stays under the charts on Overview; the Users tab shows it alone. */}
      <Tabs value={tab} onValueChange={v => setTab(String(v))}>
        <TabsList variant='line' className='mb-4'>
          <TabsTrigger value='overview'>Overview</TabsTrigger>
          <TabsTrigger value='users'>Users</TabsTrigger>
        </TabsList>
        <TabsContent value='overview'>{tab === 'overview' && <PlayersTab withStats />}</TabsContent>
        <TabsContent value='users'>{tab === 'users' && <PlayersTab withStats={false} />}</TabsContent>
      </Tabs>
    </div>
  )
}

export default PlayerReports
