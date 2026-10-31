'use client'

import { useState } from 'react'

import { PlusIcon, UnlockIcon } from 'lucide-react'

import { useStatsFilters } from '@/components/shared/charts'
import Can from '@/components/shared/Can'
import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import ErrorState from '@/components/shared/ErrorState'
import FormDialog from '@/components/shared/FormDialog'
import { TextField } from '@/components/shared/FormField'
import Money from '@/components/shared/Money'
import PageHeader from '@/components/shared/PageHeader'
import StatCard from '@/components/shared/StatCard'
import StatusBadge from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useApi, useApiMutation, useListState, usePagedApi } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { formatNumber } from '@/lib/format'
import { check } from '@/lib/validate'
import AffiliateSettings from '@/views/site-config/AffiliateSettings'
import RewardStats from './RewardStats'
import type { AffiliateMember, AffiliateReward, AffiliateStats, AffiliateTeam, AffiliateTeamMember, AffiliateTop } from './types'
import { useLocalList } from './useLocalList'

const INVALIDATE = [['api', 'admin/user/affiliate/stats'], ['paged', 'admin/user/affiliate/rewards'], ['api', 'admin/user/affiliate/top']]

const TeamMembers = ({ owner, onClose }: { owner: string; onClose: () => void }) => {
  const { page, limit, set } = useLocalList()
  const list = usePagedApi<AffiliateTeamMember>(`admin/user/affiliate/teams/${encodeURIComponent(owner)}/members`, { limit, page })

  const columns: Column<AffiliateTeamMember>[] = [
    { key: 'member', header: 'Member', cell: r => <span className='font-medium'>{r.member}</span> },
    { key: 'code', header: 'Referral code', cell: r => <span className='font-mono text-xs'>{r.referralCode ?? '—'}</span> },
    { key: 'joined', header: 'Joined', cell: r => <DateTime value={r.joinedAt} /> }
  ]

  return (
    <Card className='shadow-none'>
      <CardHeader>
        <CardTitle className='flex items-center justify-between text-base'>
          <span>Team of {owner}</span>
          <Button variant='ghost' size='sm' onClick={onClose}>Close</Button>
        </CardTitle>
        <CardDescription>Users who signed up with this referrer&apos;s referral code.</CardDescription>
      </CardHeader>
      <CardContent>
        <DataTable columns={columns} rows={list.data?.rows} rowKey={r => r.member} loading={list.isLoading} error={list.error} pagination={list.data?.pagination} onPageChange={p => set({ page: p })} onLimitChange={l => set({ limit: l })} dense />
      </CardContent>
    </Card>
  )
}

const Teams = () => {
  const { state, set, query } = useListState()
  const list = usePagedApi<AffiliateTeam>('admin/user/affiliate/teams', { limit: query.limit, page: query.page, search: state.search || undefined })
  const [owner, setOwner] = useState<string | null>(null)

  const columns: Column<AffiliateTeam>[] = [
    { key: 'owner', header: 'Referrer', cell: r => <span className='font-medium'>{r.owner}</span> },
    { key: 'members', header: 'Members', align: 'right', cell: r => formatNumber(r.members) }
  ]

  return (
    <div className='grid gap-4'>
      <DataTable
        columns={columns}
        rows={list.data?.rows}
        rowKey={r => r.owner}
        loading={list.isLoading}
        fetching={list.isFetching}
        error={list.error}
        pagination={list.data?.pagination}
        onPageChange={page => set({ page })}
        onLimitChange={limit => set({ limit })}
        search={String(state.search ?? '')}
        onSearchChange={search => set({ search })}
        searchPlaceholder='Referrer username…'
        onRowClick={r => setOwner(r.owner)}
        emptyMessage='No referral teams yet.'
      />
      {owner && <TeamMembers key={owner} owner={owner} onClose={() => setOwner(null)} />}
    </div>
  )
}

const Members = () => {
  const { page, limit, set } = useLocalList()
  const list = usePagedApi<AffiliateMember>('admin/user/affiliate/members', { limit, page })

  const columns: Column<AffiliateMember>[] = [
    { key: 'member', header: 'Member', cell: r => <span className='font-medium'>{r.member}</span> },
    { key: 'owner', header: 'Referred by', cell: r => r.owner },
    { key: 'joined', header: 'Joined', cell: r => <DateTime value={r.joinedAt} /> }
  ]

  return <DataTable columns={columns} rows={list.data?.rows} rowKey={(r, i) => `${r.owner}/${r.member}/${i}`} loading={list.isLoading} fetching={list.isFetching} error={list.error} pagination={list.data?.pagination} onPageChange={p => set({ page: p })} onLimitChange={l => set({ limit: l })} dense emptyMessage='Nobody has joined a team yet.' />
}

const Top = () => {
  const q = useApi<AffiliateTop[]>('admin/user/affiliate/top', { limit: 50 })

  const columns: Column<AffiliateTop>[] = [
    { key: 'rank', header: '#', cell: (_, i) => <span className='tabular-nums'>{i + 1}</span> },
    { key: 'owner', header: 'Referrer', cell: r => <span className='font-medium'>{r.owner}</span> },
    { key: 'rewards', header: 'Rewards', align: 'right', cell: r => formatNumber(r.rewards) },
    { key: 'total', header: 'Unlocked total', align: 'right', cell: r => <Money value={r.total} currency={r.currency} /> }
  ]

  return <DataTable columns={columns} rows={q.data} rowKey={r => r.owner} loading={q.isLoading} error={q.error} dense emptyMessage='No rewards unlocked yet.' />
}

const Rewards = () => {
  const { page, limit, set } = useLocalList()
  const [claimed, setClaimed] = useState('all')
  const [owner, setOwner] = useState('')
  const list = usePagedApi<AffiliateReward>('admin/user/affiliate/rewards', { limit, page, claimed: claimed === 'all' ? undefined : claimed === 'yes', owner: owner || undefined })

  const [record, setRecord] = useState({ ownerName: '', memberName: '', referralCode: '', amount: '', coin: '' })
  const [unlockName, setUnlockName] = useState('')

  const recordM = useApiMutation({
    fn: () => api.post('admin/user/affiliate/rewards', { ownerName: record.ownerName, memberName: record.memberName, referralCode: record.referralCode, amount: record.amount, ...(record.coin ? { coin: record.coin } : {}) }),
    invalidate: INVALIDATE,
    success: 'Reward recorded',
    onSuccess: () => setRecord({ ownerName: '', memberName: '', referralCode: '', amount: '', coin: '' })
  })

  const unlockM = useApiMutation({
    fn: () => api.post('admin/user/affiliate/unlock', { memberName: unlockName }),
    invalidate: INVALIDATE,
    success: 'Reward unlocked for the referrer',
    onSuccess: () => setUnlockName('')
  })

  const columns: Column<AffiliateReward>[] = [
    { key: 'id', header: '#', cell: r => <span className='font-mono text-xs'>{r.id}</span> },
    { key: 'owner', header: 'Referrer', cell: r => <span className='font-medium'>{r.owner}</span> },
    { key: 'member', header: 'For member', cell: r => r.member },
    { key: 'kind', header: 'Type', cell: r => <Badge variant={r.kind === 'commission' ? 'secondary' : 'outline'}>{r.kind === 'commission' ? 'Commission' : 'Joining / tier'}</Badge> },
    { key: 'tier', header: 'Wager tier', cell: r => (r.kind !== 'commission' && r.tier ? <Badge variant='outline'>{r.tier}</Badge> : '—') },
    { key: 'amount', header: 'Amount', align: 'right', cell: r => <Money value={r.amount} currency={r.currency} /> },
    { key: 'claimed', header: 'Claimed', cell: r => <StatusBadge value={r.claimed ? 'completed' : 'pending'} /> }
  ]

  return (
    <DataTable
      columns={columns}
      rows={list.data?.rows}
      rowKey={r => r.id}
      loading={list.isLoading}
      fetching={list.isFetching}
      error={list.error}
      pagination={list.data?.pagination}
      onPageChange={p => set({ page: p })}
      onLimitChange={l => set({ limit: l })}
      emptyMessage='No unlocked rewards.'
      toolbar={
        <>
          <Input className='w-44' placeholder='Referrer username' value={owner} onChange={e => { setOwner(e.target.value); set({ page: 1 }) }} />
          <Select value={claimed} onValueChange={v => { if (v) { setClaimed(v); set({ page: 1 }) } }}>
            <SelectTrigger className='w-36'><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>Claimed or not</SelectItem>
              <SelectItem value='yes'>Claimed</SelectItem>
              <SelectItem value='no'>Unclaimed</SelectItem>
            </SelectContent>
          </Select>
          <span className='grow' />
          <Can permission='config:write'>
            <FormDialog
              trigger={<Button variant='outline' size='sm'><UnlockIcon /> Unlock for member</Button>}
              title='Unlock a referral reward'
              description="Names the MEMBER. The platform reads their wager total and picks the tier itself; there is no amount to enter."
              submitLabel='Unlock'
              onSubmit={() => unlockM.mutateAsync()}
              validate={() => ({ 'un-member': check.required(unlockName, 'Member username') || check.length(unlockName, 'Member username', { max: 120 }) })}
            >
              <TextField id='un-member' name='memberName' label='Member username' required value={unlockName} onChange={e => setUnlockName(e.target.value)} />
            </FormDialog>
            <FormDialog
              trigger={<Button size='sm'><PlusIcon /> Record reward</Button>}
              title='Record a manual reward'
              description='Writes a reward row in the ledger for a referrer / member pair. Amount is a decimal string.'
              submitLabel='Record'
              onSubmit={() => recordM.mutateAsync()}
              validate={() => ({
                'rw-owner': check.required(record.ownerName, 'Referrer username') || check.length(record.ownerName, 'Referrer username', { max: 120 }),
                'rw-member': check.required(record.memberName, 'Member username') || check.length(record.memberName, 'Member username', { max: 120 }),
                'rw-code': check.required(record.referralCode, 'Referral code') || check.length(record.referralCode, 'Referral code', { max: 120 }),
                'rw-amount': check.amount(record.amount),
                'rw-coin': check.length(record.coin, 'Coin', { max: 10 })
              })}
            >
              <div className='grid grid-cols-2 gap-3'>
                <TextField id='rw-owner' name='ownerName' label='Referrer username' required value={record.ownerName} onChange={e => setRecord({ ...record, ownerName: e.target.value })} />
                <TextField id='rw-member' name='memberName' label='Member username' required value={record.memberName} onChange={e => setRecord({ ...record, memberName: e.target.value })} />
              </div>
              <TextField id='rw-code' name='referralCode' label='Referral code' required maxLength={120} value={record.referralCode} onChange={e => setRecord({ ...record, referralCode: e.target.value })} />
              <div className='grid grid-cols-2 gap-3'>
                <TextField id='rw-amount' name='amount' label='Amount' required placeholder='10.00' value={record.amount} onChange={e => setRecord({ ...record, amount: e.target.value })} />
                <TextField id='rw-coin' label='Coin' placeholder='USDT' maxLength={10} value={record.coin} onChange={e => setRecord({ ...record, coin: e.target.value })} />
              </div>
            </FormDialog>
          </Can>
        </>
      }
    />
  )
}

const Affiliate = () => {
  const stats = useApi<AffiliateStats>('admin/user/affiliate/stats')
  const s = stats.data
  const f = useStatsFilters({ defaultPreset: '30d' })

  return (
    <div>
      <PageHeader
        title='Affiliate programme'
        description='Referral teams, who is bringing in users, and the reward ledger. Rates (register bonus, commission %) are on the Rates tab.'
      />
      {stats.error && <div className='mb-4'><ErrorState error={stats.error} /></div>}
      <div className='mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4'>
        <StatCard label='Teams' value={formatNumber(s?.teams)} hint={`${formatNumber(s?.members)} members`} loading={stats.isLoading} />
        <StatCard label='Unlocked' value={<Money value={s?.unlockedTotal} currency={s?.currency} />} hint={`${formatNumber(s?.unlockedCount)} rewards`} loading={stats.isLoading} />
        <StatCard label='Claimed' value={<Money value={s?.claimedTotal} currency={s?.currency} />} hint={`${formatNumber(s?.claimedCount)} rewards`} loading={stats.isLoading} />
        <StatCard label='Outstanding' value={<Money value={s?.outstanding} currency={s?.currency} />} hint='unlocked, not yet claimed' loading={stats.isLoading} />
      </div>
      <RewardStats section='affiliate' filters={f} />
      <Tabs defaultValue='teams'>
        <TabsList className='mb-4'>
          <TabsTrigger value='teams'>Teams</TabsTrigger>
          <TabsTrigger value='members'>Members</TabsTrigger>
          <TabsTrigger value='top'>Top referrers</TabsTrigger>
          <TabsTrigger value='rewards'>Rewards</TabsTrigger>
          <Can permission='config:read'>
            <TabsTrigger value='rates'>Rates</TabsTrigger>
          </Can>
        </TabsList>
        <TabsContent value='teams'><Teams /></TabsContent>
        <TabsContent value='members'><Members /></TabsContent>
        <TabsContent value='top'><Top /></TabsContent>
        <TabsContent value='rewards'><Rewards /></TabsContent>
        {/* Pehle alag page tha (Site Config → Affiliate rates); ab yahin tab me. */}
        <Can permission='config:read'>
          <TabsContent value='rates'><AffiliateSettings embedded /></TabsContent>
        </Can>
      </Tabs>
    </div>
  )
}

export default Affiliate
