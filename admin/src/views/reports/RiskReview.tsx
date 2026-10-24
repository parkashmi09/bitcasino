'use client'

import { useState } from 'react'

import { SearchIcon } from 'lucide-react'

import DataTable, { type Column } from '@/components/shared/DataTable'
import ErrorState from '@/components/shared/ErrorState'
import Money from '@/components/shared/Money'
import PageHeader from '@/components/shared/PageHeader'
import StatCard from '@/components/shared/StatCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useApi } from '@/hooks/use-api'
import { formatNumber } from '@/lib/format'
import { RiskManagementPanel } from '@/views/players/RiskManagement'
import { type Exposure } from './types'

const IdLookup = ({ label, onSubmit }: { label: string; onSubmit: (id: string) => void }) => {
  const [id, setId] = useState('')

  return (
    <form
      className='flex items-center gap-2'
      onSubmit={e => {
        e.preventDefault()
        if (id.trim()) onSubmit(id.trim())
      }}
    >
      <Input placeholder={label} className='w-48' value={id} onChange={e => setId(e.target.value.replace(/\D/g, ''))} />
      <Button type='submit' variant='outline' disabled={!id}>
        <SearchIcon /> Review
      </Button>
    </form>
  )
}

/** One user's full risk panel (same as the player page's Risk tab): profile, money, IPs, all bets, lock switches. */
const UserRiskTab = () => {
  const [id, setId] = useState('')

  return (
    <div className='grid gap-4'>
      <IdLookup label='User id' onSubmit={setId} />
      {id && <RiskManagementPanel key={id} userId={id} />}
    </div>
  )
}

const GenericTable = ({ rows }: { rows: Record<string, unknown>[] | undefined }) => {
  const keys = rows?.length ? Object.keys(rows[0]) : []

  const columns: Column<Record<string, unknown>>[] = keys.map(k => ({
    key: k,
    header: k,
    cell: r => <span className='text-xs'>{typeof r[k] === 'object' && r[k] !== null ? JSON.stringify(r[k]) : String(r[k] ?? '—')}</span>
  }))

  return <DataTable columns={columns.length ? columns : [{ key: 'none', header: 'Rows', cell: () => null }]} rows={rows ?? []} rowKey={(r, i) => String(r.id ?? i)} dense />
}

const ExposureTab = () => {
  const exposure = useApi<Exposure>('admin/accounts/exposure/sports')

  return (
    <div className='grid gap-4'>
      {exposure.error && <ErrorState error={exposure.error} />}
      <div className='grid grid-cols-2 gap-4 lg:grid-cols-4'>
        <StatCard label='Net sports exposure' value={<Money value={exposure.data?.total} />} hint='across your tree' loading={exposure.isLoading} />
        <StatCard label='Accounts exposed' value={formatNumber(exposure.data?.rows?.length)} loading={exposure.isLoading} />
      </div>
      <GenericTable rows={exposure.data?.rows} />
    </div>
  )
}

const RiskReview = () => (
  <div>
    <PageHeader title='Risk review' description='Exposure, velocity and flags for one user; net sports exposure; and account locks.' />
    <Tabs defaultValue='user'>
      <TabsList className='mb-4'>
        <TabsTrigger value='user'>User risk</TabsTrigger>
        <TabsTrigger value='exposure'>Net exposure</TabsTrigger>
      </TabsList>
      <TabsContent value='user'>
        <UserRiskTab />
      </TabsContent>
      <TabsContent value='exposure'>
        <ExposureTab />
      </TabsContent>
    </Tabs>
  </div>
)

export default RiskReview
