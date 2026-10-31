'use client'

import { useState } from 'react'

import Link from 'next/link'

import { ArrowLeftRightIcon, NetworkIcon, FileSpreadsheetIcon, FileTextIcon, HandCoinsIcon, InfoIcon, PlusIcon, ReceiptTextIcon, ShieldIcon } from 'lucide-react'

import type { Channel } from '@/components/shared/ChannelTabs'
import DataTable, { type Column } from '@/components/shared/DataTable'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useApi, useListState } from '@/hooks/use-api'
import { RiskManagementDialog } from '@/views/players/RiskManagement'
import BalanceSheetDialog from '@/views/players/users/BalanceSheetDialog'
import { fmt } from './accountMoney'
import { exportExcel, exportPdf } from './exportList'
import FundsDialog, { type FundsKind } from './FundsDialog'
import MoreDialog from './MoreDialog'
import type { AccountRow, AccountsResponse } from './types'

/** Zip ke "Account Type" label: User, Agent, Master … */
export const accountTypeLabel = (row: AccountRow) => (row.accountType === 'user' ? 'User' : row.role)

/** Action buttons: halka rangeen pill, hover pe poora rang + glow. */
const PILL = 'h-7 rounded-full px-3 text-xs ring-1 ring-inset hover:text-white hover:shadow-md hover:-translate-y-px'

const lockSwitch = (on: boolean) => <Switch checked={on} disabled aria-label={on ? 'Locked' : 'Not locked'} />

/**
 * Account List — zip ka `users/Users.jsx`.
 *
 * Sirf DIRECT children. Staff ke naam pe click = uske children (drill-down, sirf dekhna — wahan
 * D/W nahi, sirf "P"). Har row pe rangeen button — "Deposit / Withdraw" (simple, `admin/staff/transfer`),
 * "Settlement" (points settle) — dabane pe zip ke wallet jaisa − / + popup khulta hai; aur More.
 * Sirf Agent Users (`channel=agent`) — direct users Agent Management me nahi aate.
 */
const AccountListBody = ({ channel }: { channel?: Channel }) => {
  const title = 'Account List'
  const { state, set, query } = useListState(['parentId', 'accountType'])
  const limit = Number(query.limit ?? 20)
  const page = Number(query.page ?? 1)
  const parentId = query.parentId || undefined

  // Kis row ka kaun sa popup khula hai (Deposit / Withdraw ya Settlement).
  const [open, setOpen] = useState<{ row: AccountRow; kind: FundsKind } | null>(null)
  const [risk, setRisk] = useState<AccountRow | null>(null)
  const [sheet, setSheet] = useState<AccountRow | null>(null)

  const { data, isLoading, isFetching, error } = useApi<AccountsResponse>('admin/exchange/accounts', {
    limit,
    offset: (page - 1) * limit,
    search: query.search || undefined,
    parentId,
    channel,
    accountType: query.accountType || undefined
  })

  const rows = data?.rows ?? []
  const total = data?.pagination.total ?? 0

  const userName: Column<AccountRow> = {
    key: 'username',
    header: 'User Name',
    cell: r =>
      r.accountType === 'staff' ? (
        <Link href={`?parentId=${r.accountId}`} className='text-primary underline-offset-2 hover:underline' title={r.username}>
          {r.username}
        </Link>
      ) : (
        <span title={r.username}>{r.username}</span>
      )
  }

  const cr: Column<AccountRow> = {
    key: 'cr',
    header: 'CR',
    align: 'right',

    // Sirf number — deposit / withdraw Action menu se.
    cell: r => <span className='text-warning block text-right tabular-nums'>{fmt(r.credit)}</span>
  }

  // Agent / staff row: opens its downline (same list, `?parentId=`).
  const downline = (r: AccountRow) =>
    r.accountType === 'staff' && (
      <Button size='sm' title='Downline users' nativeButton={false} render={<Link href={`?parentId=${r.accountId}`} />} className={`${PILL} bg-primary/10 text-primary ring-primary/30 hover:bg-primary hover:shadow-primary/40`}>
        <NetworkIcon /> Downline
      </Button>
    )

  const action: Column<AccountRow> = {
    key: 'action',
    header: 'Action',
    cell: r =>
      parentId ? (

        // Drill-down list: no D/W; "P" opens the same More window (password, lock).
        <div className='flex gap-1.5'>
          {downline(r)}
          <MoreDialog row={r} trigger={<Button size='sm' variant='secondary'>P</Button>} />
        </div>
      ) : (
        <div className='flex gap-1.5'>
          {downline(r)}
          <Button size='sm' title='Deposit / Withdraw' className={`${PILL} bg-success-soft text-success ring-success/30 hover:bg-success hover:shadow-success/40`} onClick={() => setOpen({ row: r, kind: 'dw' })}>
            <ArrowLeftRightIcon /> D / W
          </Button>
          <Button size='sm' title='Settlement' className={`${PILL} bg-warning-soft text-warning ring-warning/30 hover:bg-warning hover:text-black hover:shadow-warning/40`} onClick={() => setOpen({ row: r, kind: 'settle' })}>
            <HandCoinsIcon /> Settle
          </Button>
          <MoreDialog
            row={r}
            trigger={
              <Button size='sm' title='More details' className={`${PILL} bg-info-soft text-info ring-info/30 hover:bg-info hover:shadow-info/40`}>
                <InfoIcon /> More
              </Button>
            }
          />
        </div>
      )
  }

  // Points columns (user, 2026-10-17): balance, exposure, sports / casino (third-party) points, P/L = settlement points.
  const num = (key: string, header: string, pick: (r: AccountRow) => string, tone = '') => ({
    key,
    header,
    align: 'right' as const,
    cell: (r: AccountRow) => {
      const n = Number(pick(r) || 0)

      return <span className={`block text-right tabular-nums ${tone || (n < 0 ? 'text-danger' : '')}`}>{fmt(n)}</span>
    }
  })

  const points: Column<AccountRow>[] = [
    num('bal', 'Balance', r => r.available),
    num('exp', 'Exposure', r => r.exposure, 'text-danger'),
    num('spts', 'Sports Pts', r => r.sportsPts),
    num('cpts', 'Casino Pts', r => r.casinoPts),
    num('opts', 'Original Pts', r => r.originalPts),
    num('pl', 'P/L', r => r.settlementPoints)
  ]

  // Risk management + balance sheet: only on rows whose Account Type is User.
  const userTools: Column<AccountRow> = {
    key: 'risk',
    header: 'Risk',
    cell: r =>
      r.accountType === 'user' ? (
        <div className='flex gap-0.5'>
          <Button size='icon-sm' variant='ghost' className='hover:text-warning' title='Risk management' aria-label='Risk management' onClick={() => setRisk(r)}>
            <ShieldIcon />
          </Button>
          <Button size='icon-sm' variant='ghost' className='hover:text-primary' title='Balance sheet' aria-label='Balance sheet' onClick={() => setSheet(r)}>
            <ReceiptTextIcon />
          </Button>
        </div>
      ) : null
  }

  const tail: Column<AccountRow>[] = [
    { key: 'bst', header: 'B st', cell: r => lockSwitch(r.betLocked) },
    { key: 'ust', header: 'U st', cell: r => lockSwitch(r.userLocked) },
    { key: 'pname', header: 'PName', cell: r => `${r.percentage ?? 1} Pt` },
    { key: 'type', header: 'Account Type', cell: r => accountTypeLabel(r) },
    action
  ]

  const columns: Column<AccountRow>[] = [userName, userTools, cr, ...points, ...tail]

  // Export — zip jaisa: wahi columns, raw numbers.
  const exportHead = ['User Name', 'CR', 'Balance', 'Exposure', 'Sports Pts', 'Casino Pts', 'Original Pts', 'P/L', 'B st', 'U st', 'PName', 'Account Type']

  const exportRows = () =>
    rows.map(r => {
      const locks = [r.betLocked ? 'Locked' : 'Open', r.userLocked ? 'Locked' : 'Open', `${r.percentage ?? 1} Pt`, accountTypeLabel(r)]

      return [r.username, r.credit, r.available, r.exposure, r.sportsPts, r.casinoPts, r.originalPts, r.settlementPoints, ...locks]
    })

  const fileName = 'userlist'

  return (
    <div>
      <DataTable
        toolbar={
          <div className='ml-auto flex flex-wrap gap-2'>
            <Select value={String(state.accountType || 'all')} onValueChange={v => v && set({ accountType: v === 'all' ? '' : v, page: 1 })}>
              <SelectTrigger className='w-32' aria-label='Account type'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>All</SelectItem>
                <SelectItem value='staff'>Staff</SelectItem>
                <SelectItem value='user'>User</SelectItem>
              </SelectContent>
            </Select>
            {parentId && (
              <Button variant='outline' onClick={() => set({ parentId: '', page: 1 })}>
                Back to my list
              </Button>
            )}
            <Button variant='outline' size='icon' disabled={!rows.length} onClick={() => exportExcel(fileName, exportHead, exportRows())} aria-label='Excel'>
              <FileSpreadsheetIcon />
            </Button>
            <Button variant='outline' size='icon' disabled={!rows.length} onClick={() => exportPdf(fileName, title, exportHead, exportRows())} aria-label='PDF'>
              <FileTextIcon />
            </Button>
            <Button render={<Link href='/exchange/users/create' />} nativeButton={false}>
              <PlusIcon /> Create Account
            </Button>
          </div>
        }
        columns={columns}
        rows={rows}
        rowKey={r => `${r.accountType}-${r.accountId}`}
        loading={isLoading}
        fetching={isFetching}
        error={error}
        search={String(state.search ?? '')}
        onSearchChange={value => set({ search: value, page: 1 })}
        searchPlaceholder='Search User'
        emptyMessage='There are no records to show'
        pagination={{ page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1), hasNext: page * limit < total, hasPrev: page > 1 }}
        onPageChange={p => set({ page: p })}
        onLimitChange={l => set({ limit: l, page: 1 })}
      />
      <RiskManagementDialog userId={risk?.accountId ?? null} name={risk?.username} open={!!risk} onOpenChange={o => !o && setRisk(null)} />
      <BalanceSheetDialog userId={sheet?.accountId ?? null} name={sheet?.username} client open={!!sheet} onOpenChange={o => !o && setSheet(null)} />
      {open && data && <FundsDialog kind={open.kind} row={open.row} me={data.me} open onOpenChange={o => !o && setOpen(null)} />}
    </div>
  )
}

const AccountList = () => {
  const { query } = useListState(['parentId'])
  const parentId = query.parentId || undefined

  return (
    <div>
      <PageHeader
        title='Account List'
        description={parentId ? 'Downline of the selected account. P opens its details, password and lock.' : 'Your accounts. Deposit / Withdraw moves credit; Settlement settles the Client(P/L).'}
      />
      <AccountListBody channel='agent' />
    </div>
  )
}

export default AccountList
