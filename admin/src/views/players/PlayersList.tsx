'use client'

import { useState } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { parseAsString, useQueryStates } from 'nuqs'

import { ChartColumnIcon, LandmarkIcon, NetworkIcon, UserIcon, UsersIcon } from 'lucide-react'

import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import PageHeader from '@/components/shared/PageHeader'
import StatusBadge from '@/components/shared/StatusBadge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSession } from '@/contexts/SessionContext'
import { useListState, usePagedApi } from '@/hooks/use-api'
import { cn } from '@/lib/utils'
import { RiskManagementDialog } from './RiskManagement'
import BalanceSheetDialog from './users/BalanceSheetDialog'
import FinancialTab from './users/FinancialTab'
import type { UserRow } from './users/shared'
import UsersTable from './users/UsersTable'
import UserStatusOverview from './UserStatusOverview'

/** `GET admin/user/directory` — the allow-listed player columns, tree-scoped, guarded by users:read. */
type DirectoryRow = {
  id: number | string
  name: string
  email: string | null
  phone: string | null
  status: string
  is_locked: boolean | null
  system_locked: boolean | null
  parent_staff_id: number | null
  created: string | null
}

const directoryColumns: Column<DirectoryRow>[] = [
  {
    key: 'name',
    header: 'User',
    cell: r => (
      <div className='flex flex-col'>
        <Link href={`/users/${r.id}`} className='font-medium hover:underline'>
          {r.name}
        </Link>
        <span className='text-muted-foreground font-mono text-xs'>{r.id}</span>
      </div>
    )
  },
  { key: 'status', header: 'Status', cell: r => <StatusBadge value={r.system_locked ? 'Locked' : r.status} /> },
  { key: 'email', header: 'Email', cell: r => <span className='text-sm'>{r.email ?? '—'}</span> },
  { key: 'phone', header: 'Phone', cell: r => <span className='text-sm'>{r.phone ?? '—'}</span> },
  { key: 'created', header: 'Joined', cell: r => (r.created ? <DateTime value={r.created} relative /> : '—') }
]

/**
 * The Users list for a login holding users:read without reports:read (e.g. an executive granted
 * only users:read). `admin/reports/players` would refuse it, so it reads the player directory,
 * which carries no balances or lifetime totals.
 */
const DirectoryList = () => {
  const { state, set, query } = useListState()
  const list = usePagedApi<DirectoryRow>('admin/user/directory', { limit: query.limit, page: query.page, search: query.search || undefined })
  const router = useRouter()

  return (
    <div>
      <PageHeader
        title='Users'
        description='Every user account in your tree.'
      />
      <DataTable
        columns={directoryColumns}
        rows={list.data?.rows}
        rowKey={r => String(r.id)}
        loading={list.isLoading}
        fetching={list.isFetching}
        error={list.error}
        pagination={list.data?.pagination}
        onPageChange={page => set({ page })}
        onLimitChange={limit => set({ limit })}
        search={String(state.search ?? '')}
        onSearchChange={search => set({ search })}
        searchPlaceholder='Username, email, phone…'
        onRowClick={r => router.push(`/users/${r.id}`)}
      />
    </div>
  )
}

const PlayersList = () => {
  const { can } = useSession()

  // The full page is `admin/reports/*` (reports:read); users:read alone gets the directory.
  return can('reports:read') ? <UsersPage /> : <DirectoryList />
}

type Section = 'direct' | 'agent' | 'financial'

/**
 * Users page — reference admin (`admin-structure.zip` → components/Users.tsx) jaisa, teen tab:
 *
 *   Direct Users  — parent nahi (site pe signup)          → UsersTable channel=direct
 *   Agent System  — parent hai (agent / staff ne banaya)   → UsersTable channel=agent + Parent Staff
 *   Financial     — withdrawal rules + per-user withdrawal lock
 *
 * Direct Users aur Financial sirf house staff ko (reference: SuperAdmin / MotherAdmin); agent tree
 * ko sirf Agent System. Har row ke Risk column se Risk Management aur Balance Sheet dialog.
 * Tab URL me `?tab=agent|financial`.
 */
const UsersPage = () => {
  // The tab lives in the URL through nuqs, like the table's search/page, so the two never overwrite each other.
  const [url, setUrl] = useQueryStates({ tab: parseAsString, search: parseAsString, page: parseAsString }, { history: 'replace', scroll: false })
  const { actor } = useSession()
  const house = actor?.direct === true
  const promotions = actor?.promotions === true

  const sections: { value: Section; label: string; icon: React.ReactNode }[] = [
    ...(house ? [{ value: 'direct' as const, label: 'Direct Users', icon: <UserIcon /> }] : []),
    { value: 'agent', label: 'Agent System', icon: <NetworkIcon /> },
    ...(house ? [{ value: 'financial' as const, label: 'Financial', icon: <LandmarkIcon /> }] : [])
  ]

  const section: Section = sections.find(s => s.value === url.tab)?.value ?? sections[0].value
  // A new tab starts unfiltered on page 1.
  const select = (value: Section) => void setUrl({ tab: value === sections[0].value ? null : value, search: null, page: null })

  // Users / Overview (graphs) — Direct aur Agent tab me.
  const [view, setView] = useState<'users' | 'overview'>('users')
  const [risk, setRisk] = useState<UserRow | null>(null)
  const [sheet, setSheet] = useState<UserRow | null>(null)

  // Tabs ki line me hi, right side (Financial pe nahi).
  const viewToggle = (
    <div className='ml-auto flex rounded-md border p-0.5'>
        {(
          [
            { v: 'users', label: 'Users', icon: <UsersIcon /> },
            { v: 'overview', label: 'Overview', icon: <ChartColumnIcon /> }
          ] as const
        ).map(o => (
          <button
            key={o.v}
            type='button'
            onClick={() => setView(o.v)}
            className={cn(
              'flex items-center gap-1.5 rounded px-3 py-1 text-sm font-semibold [&_svg]:size-4',
              view === o.v ? 'bg-accent text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {o.icon}
            {o.label}
          </button>
        ))}
    </div>
  )

  const userSection = (channel: 'direct' | 'agent') => (
    <>
      {view === 'users' ? (
        <UsersTable
          channel={channel}
          title={channel === 'direct' ? 'Direct Users' : 'Agent System — Users'}
          showStaffColumn={channel === 'agent'}
          onOpenRisk={setRisk}
          onOpenBalanceSheet={setSheet}
        />
      ) : (
        <UserStatusOverview showVip={promotions} channel={channel} />
      )}
    </>
  )

  return (
    <div>
      <PageHeader title='Users' description={house ? 'Manage direct users and agent-system accounts with per-user risk controls' : 'Manage your users with per-user risk controls'} />
      <Tabs value={section} onValueChange={v => select(v as Section)}>
        <div className='mb-4 flex flex-wrap items-center gap-3'>
          {sections.length > 1 && (
            <TabsList variant='line'>
              {sections.map(s => (
                <TabsTrigger key={s.value} value={s.value}>
                  {s.icon}
                  {s.label}
                </TabsTrigger>
              ))}
            </TabsList>
          )}
          {section !== 'financial' && viewToggle}
        </div>
        {house && <TabsContent value='direct'>{section === 'direct' && userSection('direct')}</TabsContent>}
        <TabsContent value='agent'>{section === 'agent' && userSection('agent')}</TabsContent>
        {house && <TabsContent value='financial'>{section === 'financial' && <FinancialTab />}</TabsContent>}
      </Tabs>

      <RiskManagementDialog userId={risk?.id ?? null} name={risk?.name} open={risk !== null} onOpenChange={o => !o && setRisk(null)} />
      <BalanceSheetDialog userId={sheet?.id ?? null} name={sheet?.name} client={sheet?.parentStaff != null} open={sheet !== null} onOpenChange={o => !o && setSheet(null)} />
    </div>
  )
}

export default PlayersList
