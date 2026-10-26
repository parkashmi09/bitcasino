'use client'

import { useState } from 'react'

import Link from 'next/link'

import { EyeIcon, KeyRoundIcon, PencilIcon, PlusIcon, PowerIcon } from 'lucide-react'

import ConfirmDialog from '@/components/shared/ConfirmDialog'
import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import FormDialog from '@/components/shared/FormDialog'
import { TextField } from '@/components/shared/FormField'
import PageHeader from '@/components/shared/PageHeader'
import StatusBadge from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useApiMutation, useListState, usePagedApi } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { check } from '@/lib/validate'

import type { Branch } from './BranchView'

const BASE = 'admin/branches'
const invalidate = [['paged', BASE]]

const usernameError = (v: string) =>
  check.required(v, 'Username') ||
  check.length(v, 'Username', { min: 3, max: 40 }) ||
  (!/^[A-Za-z0-9._-]+$/.test(v.trim()) && 'Username may contain letters, digits and . _ - only')

const passwordError = (v: string) => (!v ? 'Password is required' : check.length(v, 'Password', { min: 8, max: 72 }))

const CreateBranch = () => {
  const empty = { name: '', username: '', password: '', confirm: '' }
  const [form, setForm] = useState(empty)

  const create = useApiMutation({
    fn: () => api.post(BASE, { name: form.name.trim(), username: form.username.trim(), password: form.password }),
    invalidate,
    success: 'Branch created',
    onSuccess: () => setForm(empty)
  })

  return (
    <FormDialog
      trigger={
        <Button>
          <PlusIcon /> New branch
        </Button>
      }
      title='Create a branch'
      description='The branch signs in at /branch with this username and password.'
      submitLabel='Create'
      validate={() => ({
        name: check.required(form.name, 'Branch name') || check.length(form.name, 'Branch name', { min: 2, max: 80 }),
        username: usernameError(form.username),
        password: passwordError(form.password),
        confirm: !form.confirm ? 'Confirm the password' : check.match(form.password, form.confirm, 'Passwords do not match')
      })}
      onSubmit={() => create.mutateAsync()}
    >
      <TextField id='br-name' name='name' label='Branch name' required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
      <TextField id='br-user' name='username' label='Login username' required value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} />
      <div className='grid grid-cols-2 gap-4'>
        <TextField id='br-pw' name='password' label='Password' type='password' required value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
        <TextField id='br-pw2' name='confirm' label='Confirm password' type='password' required value={form.confirm} onChange={e => setForm({ ...form, confirm: e.target.value })} />
      </div>
    </FormDialog>
  )
}

const RowActions = ({ row }: { row: Branch }) => {
  const [name, setName] = useState(row.name)
  const [password, setPassword] = useState('')
  const active = row.status === 'active'

  const rename = useApiMutation({ fn: () => api.patch(`${BASE}/${row.id}`, { name: name.trim() }), invalidate, success: 'Branch renamed' })
  const toggle = useApiMutation({ fn: () => api.patch(`${BASE}/${row.id}`, { status: active ? 'inactive' : 'active' }), invalidate, success: active ? 'Branch deactivated' : 'Branch activated' })

  const resetPw = useApiMutation({
    fn: () => api.put(`${BASE}/${row.id}/password`, { password }),
    success: 'Password changed — the branch is signed out',
    onSuccess: () => setPassword('')
  })

  return (
    <div className='flex justify-end gap-0.5'>
      <Button variant='ghost' size='icon-sm' aria-label='View' title='View report' nativeButton={false} render={<Link href={`/branches/${row.id}`} />}>
        <EyeIcon />
      </Button>
      <FormDialog
        trigger={
          <Button variant='ghost' size='icon-sm' aria-label='Rename' title='Rename'>
            <PencilIcon />
          </Button>
        }
        title={`Rename ${row.name}`}
        onOpenChange={o => o && setName(row.name)}
        validate={() => ({ name: check.required(name, 'Branch name') || check.length(name, 'Branch name', { min: 2, max: 80 }) })}
        onSubmit={() => rename.mutateAsync()}
      >
        <TextField id={`br-name-${row.id}`} name='name' label='Branch name' required value={name} onChange={e => setName(e.target.value)} />
      </FormDialog>
      <FormDialog
        trigger={
          <Button variant='ghost' size='icon-sm' aria-label='Change password' title='Change password'>
            <KeyRoundIcon />
          </Button>
        }
        title={`New password for ${row.username}`}
        description='At least 8 characters. The branch is signed out and signs in again with it.'
        submitLabel='Change'
        validate={() => ({ password: passwordError(password) })}
        onSubmit={() => resetPw.mutateAsync()}
      >
        <TextField id={`br-pw-${row.id}`} name='password' label='New password' type='password' required value={password} onChange={e => setPassword(e.target.value)} />
      </FormDialog>
      <ConfirmDialog
        trigger={
          <Button variant='ghost' size='icon-sm' aria-label={active ? 'Deactivate' : 'Activate'} title={active ? 'Deactivate' : 'Activate'} className={active ? 'text-destructive' : ''}>
            <PowerIcon />
          </Button>
        }
        title={active ? `Deactivate ${row.name}?` : `Activate ${row.name}?`}
        description={active ? 'The branch is signed out and cannot sign in. Its players keep playing on the site.' : 'The branch can sign in again.'}
        confirmLabel={active ? 'Deactivate' : 'Activate'}
        destructive={active}
        onConfirm={() => toggle.mutateAsync()}
      />
    </div>
  )
}

const BranchesList = () => {
  const { state, set, query } = useListState(['status'])
  const list = usePagedApi<Branch>(BASE, { limit: query.limit, page: query.page, search: query.search, status: query.status })

  const columns: Column<Branch>[] = [
    { key: 'name', header: 'Branch', cell: r => <Link href={`/branches/${r.id}`} className='font-medium hover:underline'>{r.name}</Link> },
    { key: 'username', header: 'Login', cell: r => <span className='font-mono text-xs'>{r.username}</span> },
    { key: 'status', header: 'Status', cell: r => <StatusBadge value={r.status} /> },
    { key: 'players', header: 'Players', align: 'right', cell: r => <span className='tabular-nums'>{r.players ?? 0}</span> },
    { key: 'last', header: 'Last login', cell: r => <DateTime value={r.lastLoginAt} relative /> },
    { key: 'created', header: 'Created', cell: r => <DateTime value={r.createdAt} /> },
    { key: 'actions', header: '', align: 'right', cell: r => <RowActions row={r} /> }
  ]

  return (
    <div>
      <PageHeader title='Branches' description='Each branch signs in at /branch, creates its own players and sees their deposits, withdrawals and play.' actions={<CreateBranch />} />
      <DataTable
        columns={columns}
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
        searchPlaceholder='Name or username…'
        toolbar={
          <Select value={String(state.status || 'all')} onValueChange={v => v && set({ status: v === 'all' ? '' : v })}>
            <SelectTrigger className='w-40'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>Any status</SelectItem>
              <SelectItem value='active'>active</SelectItem>
              <SelectItem value='inactive'>inactive</SelectItem>
            </SelectContent>
          </Select>
        }
      />
    </div>
  )
}

export default BranchesList
