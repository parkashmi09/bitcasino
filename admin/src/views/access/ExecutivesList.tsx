'use client'

import { useState } from 'react'

import { ActivityIcon, KeyRoundIcon, LockIcon, PencilIcon, PlusIcon, ShieldCheckIcon, SlidersHorizontalIcon, UnlockIcon } from 'lucide-react'

import Can from '@/components/shared/Can'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import FormDialog from '@/components/shared/FormDialog'
import { SelectField, TextField } from '@/components/shared/FormField'
import JsonView from '@/components/shared/JsonView'
import PageHeader from '@/components/shared/PageHeader'
import StatusBadge from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useSession } from '@/contexts/SessionContext'
import { useApiMutation, useListState, usePagedApi } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { check } from '@/lib/validate'
import { EXECUTIVE_ROLES, EXECUTIVE_STATUSES, PERMISSION_GROUPS, type ExecutiveActivity, type ExecutiveRow } from './types'

type Kind = 'executive' | 'marketing'

const BASE: Record<Kind, string> = { executive: 'admin/access/executives', marketing: 'admin/access/marketing-users' }

/** Multi-select over the platform vocabulary; never offers more than the operator holds (the server intersects anyway). */
const PermissionPicker = ({ value, onChange, instantRoles = false }: { value: string[]; onChange: (next: string[]) => void; instantRoles?: boolean }) => {
  const { can } = useSession()
  const offered = PERMISSION_GROUPS.map(g => ({ ...g, permissions: g.permissions.filter(p => can(p)) })).filter(g => g.permissions.length)
  const all = offered.flatMap(g => g.permissions)
  const toggle = (p: string, on: boolean) => onChange(on ? [...new Set([...value, p])] : value.filter(x => x !== p))
  const roles = EXECUTIVE_ROLES.map(r => ({ ...r, permissions: r.permissions.filter(p => can(p)) })).filter(r => r.permissions.length)
  const isRole = (p: string[]) => p.length === value.length && p.every(x => value.includes(x))

  return (
    <div className='grid gap-3'>
      {instantRoles && <div className='grid gap-2'>
        <span className='text-sm font-medium'>Instant role</span>
        <div className='flex flex-wrap gap-2'>
          {roles.map(r => (
            <Button key={r.label} type='button' variant={isRole(r.permissions) ? 'default' : 'outline'} size='sm' onClick={() => onChange(r.permissions)}>
              {r.label}
            </Button>
          ))}
        </div>
      </div>}
      <div className='flex items-center justify-between'>
        <span className='text-sm font-medium'>Permissions</span>
        <span className='flex gap-2'>
          <Button type='button' variant='ghost' size='sm' onClick={() => onChange(all)}>
            Grant all
          </Button>
          <Button type='button' variant='ghost' size='sm' onClick={() => onChange([])}>
            Revoke all
          </Button>
        </span>
      </div>
      <div className='grid max-h-72 gap-3 overflow-y-auto rounded-md border p-3 sm:grid-cols-2'>
        {offered.map(g => (
          <div key={g.label}>
            <p className='text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase'>{g.label}</p>
            {g.permissions.map(p => (
              <label key={p} className='flex cursor-pointer items-center gap-2 py-0.5 text-sm'>
                <Checkbox checked={value.includes(p)} onCheckedChange={c => toggle(p, c === true)} />
                <code className='text-xs'>{p}</code>
              </label>
            ))}
          </div>
        ))}
      </div>
      <p className='text-muted-foreground text-xs'>{value.length} selected. The platform intersects the grant with your own authority.</p>
    </div>
  )
}

export const CreateSubLogin = ({ kind }: { kind: Kind }) => {
  const [form, setForm] = useState({ username: '', password: '', confirm: '' })
  const [permissions, setPermissions] = useState<string[]>(kind === 'marketing' ? ['reports:read'] : [])

  const create = useApiMutation({
    fn: () => api.post(BASE[kind], { username: form.username.trim(), password: form.password, permissions }),
    invalidate: [['paged', BASE[kind]]],
    success: kind === 'marketing' ? 'Marketing user created' : 'Executive created',
    onSuccess: () => {
      setForm({ username: '', password: '', confirm: '' })
      setPermissions(kind === 'marketing' ? ['reports:read'] : [])
    }
  })

  return (
    <FormDialog
      trigger={
        <Button>
          <PlusIcon /> {kind === 'marketing' ? 'New marketing user' : 'New executive'}
        </Button>
      }
      title={kind === 'marketing' ? 'Create a marketing user' : 'Create an executive'}
      description='A sub-login under your account. Username: letters, digits and . _ - only. Password at least 8 characters.'
      submitLabel='Create'
      wide
      validate={() => ({
        username:
          check.required(form.username, 'Username') ||
          check.length(form.username, 'Username', { min: 3, max: 100 }) ||
          (!/^[A-Za-z0-9._-]+$/.test(form.username.trim()) && 'Username may contain letters, digits and . _ - only'),
        password: !form.password ? 'Password is required' : check.length(form.password, 'Password', { min: 8, max: 200 }),
        confirm: !form.confirm ? 'Confirm the password' : check.match(form.password, form.confirm, 'Passwords do not match'),
        permissions: permissions.length === 0 && 'Give at least one permission'
      })}
      onSubmit={() => create.mutateAsync()}
    >
      <TextField id='x-user' name='username' label='Username' required minLength={3} maxLength={100} value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} />
      <div className='grid grid-cols-2 gap-4'>
        <TextField id='x-pw' name='password' label='Password' type='password' required minLength={8} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
        <TextField id='x-pw2' name='confirm' label='Confirm password' type='password' required minLength={8} value={form.confirm} onChange={e => setForm({ ...form, confirm: e.target.value })} />
      </div>
      <PermissionPicker value={permissions} onChange={setPermissions} instantRoles={kind === 'executive'} />
    </FormDialog>
  )
}

/**
 * Who may mint and manage each kind. Executives: every staff login, Super Admin down to Agent,
 * under THEMSELVES and never with a permission they do not hold (the platform refuses; an
 * executive session cannot manage executives at all). Marketing users stay with `roles:manage`.
 */
export const GRANT: Record<Kind, string | string[]> = { executive: [], marketing: 'roles:manage' }

const RowActions = ({ row, kind }: { row: ExecutiveRow; kind: Kind }) => {
  const base = BASE[kind]
  const [permissions, setPermissions] = useState<string[]>(row.permissions)
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<string>(row.status)
  const [showActivity, setShowActivity] = useState(false)

  const invalidate = [['paged', base]]
  const editAccess = useApiMutation({ fn: () => api.patch(`${base}/${row.id}`, { permissions }), invalidate, success: 'Permissions updated' })
  const resetPw = useApiMutation({ fn: () => api.patch(`${base}/${row.id}/password`, { password }), success: 'Password reset', onSuccess: () => setPassword('') })
  const setStatusM = useApiMutation({ fn: (next: string) => api.patch(`${base}/${row.id}/status`, { status: next }), invalidate, success: 'Status updated' })

  const locked = row.status === 'locked'

  return (
    <div className='flex justify-end gap-0.5' onClick={e => e.stopPropagation()}>
      <Can permission='audit:read'>
        <Button variant='ghost' size='icon-sm' aria-label='Activity' title='Activity' onClick={() => setShowActivity(true)}>
          <ActivityIcon />
        </Button>
        <ActivityDialog row={row} open={showActivity} onOpenChange={setShowActivity} />
      </Can>
      <Can permission={GRANT[kind]}>
        {kind === 'executive' && (
          <FormDialog
            trigger={
              <Button variant='ghost' size='icon-sm' aria-label='Edit access' title='Edit access'>
                <PencilIcon />
              </Button>
            }
            title={`Permissions for ${row.username}`}
            wide
            onOpenChange={o => o && setPermissions(row.permissions)}
            validate={() => (permissions.length === 0 ? 'Give at least one permission' : null)}
            onSubmit={() => editAccess.mutateAsync()}
          >
            <PermissionPicker value={permissions} onChange={setPermissions} instantRoles={kind === 'executive'} />
          </FormDialog>
        )}
        <FormDialog
          trigger={
            <Button variant='ghost' size='icon-sm' aria-label='Reset password' title='Reset password'>
              <KeyRoundIcon />
            </Button>
          }
          title={`Reset password for ${row.username}`}
          description='At least 12 characters.'
          submitLabel='Reset'
          validate={() => ({ password: !password ? 'New password is required' : check.length(password, 'New password', { min: 8, max: 200 }) })}
          onSubmit={() => resetPw.mutateAsync()}
        >
          <TextField id={`pw-${row.id}`} name='password' label='New password' type='password' required minLength={8} value={password} onChange={e => setPassword(e.target.value)} />
        </FormDialog>
        <ConfirmDialog
          trigger={
            <Button variant='ghost' size='icon-sm' aria-label={locked ? 'Unlock' : 'Lock'} title={locked ? 'Unlock' : 'Lock'} className={locked ? '' : 'text-destructive'}>
              {locked ? <UnlockIcon /> : <LockIcon />}
            </Button>
          }
          title={locked ? `Unlock ${row.username}?` : `Lock ${row.username}?`}
          description={locked ? 'They can sign in again.' : 'They cannot sign in until unlocked.'}
          confirmLabel={locked ? 'Unlock' : 'Lock'}
          destructive={!locked}
          onConfirm={() => setStatusM.mutateAsync(locked ? 'active' : 'locked')}
        />
        <FormDialog
          trigger={
            <Button variant='ghost' size='icon-sm' aria-label='Set status' title='Set status'>
              <SlidersHorizontalIcon />
            </Button>
          }
          title={`Status for ${row.username}`}
          submitLabel='Apply'
          onOpenChange={o => o && setStatus(row.status)}
          validate={() => (status === row.status ? `Already ${status} — pick a different status` : null)}
          onSubmit={() => setStatusM.mutateAsync(status)}
        >
          <SelectField id={`st-${row.id}`} label='Status' value={status} onChange={setStatus} options={EXECUTIVE_STATUSES.map(s => ({ value: s, label: s }))} />
        </FormDialog>
      </Can>
    </div>
  )
}

/** The grant as one button; the full list, grouped like the picker, opens in a dialog. */
const PermissionsButton = ({ row }: { row: ExecutiveRow }) => {
  const [open, setOpen] = useState(false)
  const groups = PERMISSION_GROUPS.map(g => ({ ...g, permissions: g.permissions.filter(p => row.permissions.includes(p)) })).filter(g => g.permissions.length)
  const known = new Set(groups.flatMap(g => g.permissions))
  const other = row.permissions.filter(p => !known.has(p))

  return (
    <>
      <Button variant='outline' size='sm' onClick={e => (e.stopPropagation(), setOpen(true))}>
        <ShieldCheckIcon /> {row.permissions.length} {row.permissions.length === 1 ? 'permission' : 'permissions'}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>Permissions · {row.username}</DialogTitle>
            <DialogDescription>What this executive may see and do.</DialogDescription>
          </DialogHeader>
          {row.permissions.length === 0 ? (
            <p className='text-muted-foreground text-sm'>No permissions.</p>
          ) : (
            <div className='grid max-h-[60vh] gap-4 overflow-y-auto sm:grid-cols-2'>
              {[...groups, ...(other.length ? [{ label: 'Other', permissions: other }] : [])].map(g => (
                <div key={g.label}>
                  <p className='text-muted-foreground mb-1.5 text-xs font-medium tracking-wide uppercase'>{g.label}</p>
                  <div className='flex flex-wrap gap-1'>
                    {g.permissions.map(p => (
                      <Badge key={p} variant='secondary' className='font-mono font-normal'>
                        {p}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

const activityColumns: Column<ExecutiveActivity>[] = [
  { key: 'at', header: 'When', cell: r => <DateTime value={r.createdAt} /> },
  { key: 'action', header: 'Action', cell: r => <code className='text-xs'>{r.action}</code> },
  { key: 'target', header: 'Target', cell: r => (r.targetType ? <Badge variant='outline'>{r.targetType} {r.targetId}</Badge> : '—') },
  { key: 'status', header: 'Outcome', cell: r => <StatusBadge value={r.status} /> },
  { key: 'ip', header: 'IP', cell: r => <span className='font-mono text-xs'>{r.ip ?? '—'}</span> },
  { key: 'details', header: 'Details', cell: r => (r.details ? <JsonView value={r.details} className='max-h-24 p-1' /> : <span className='text-muted-foreground'>—</span>) }
]

const ActivityDialog = ({ row, open, onOpenChange }: { row: ExecutiveRow; open: boolean; onOpenChange: (o: boolean) => void }) => {
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const list = usePagedApi<ExecutiveActivity>(open ? `admin/access/executives/${row.id}/activity` : null, { limit, page })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-4xl'>
        <DialogHeader>
          <DialogTitle>Activity · {row.username}</DialogTitle>
          <DialogDescription>Every action this sub-login performed, newest first.</DialogDescription>
        </DialogHeader>
        <DataTable columns={activityColumns} rows={list.data?.rows} rowKey={r => r.id} loading={list.isLoading} error={list.error} pagination={list.data?.pagination} onPageChange={setPage} onLimitChange={setLimit} dense />
      </DialogContent>
    </Dialog>
  )
}

export const SubLoginTable = ({ kind }: { kind: Kind }) => {
  const { state, set, query } = useListState(['status'])
  const list = usePagedApi<ExecutiveRow>(BASE[kind], { limit: query.limit, page: query.page, search: query.search, status: query.status })

  const columns: Column<ExecutiveRow>[] = [
    { key: 'username', header: kind === 'marketing' ? 'Username' : 'Executive', cell: r => <span className='font-medium'>{r.username}</span> },
    { key: 'status', header: 'Status', cell: r => <StatusBadge value={r.status} /> },
    { key: 'parent', header: 'Under staff', cell: r => <span className='text-sm'>#{r.parentStaffId ?? '—'}</span> },
    { key: 'last', header: 'Last login', cell: r => <DateTime value={r.lastLogin} relative /> },
    {
      key: 'perms',
      header: 'Permissions',
      cell: r => <PermissionsButton row={r} />
    },
    { key: 'actions', header: '', align: 'right', cell: r => <RowActions row={r} kind={kind} /> }
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
      onPageChange={page => set({ page })}
      onLimitChange={limit => set({ limit })}
      search={String(state.search ?? '')}
      onSearchChange={search => set({ search })}
      searchPlaceholder='Username…'
      toolbar={
        <Select value={String(state.status || 'all')} onValueChange={v => v && set({ status: v === 'all' ? '' : v })}>
          <SelectTrigger className='w-40'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>Any status</SelectItem>
            {EXECUTIVE_STATUSES.map(s => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  )
}

// Marketing users are no longer offered here (owner's call); the platform routes stay.
const ExecutivesList = () => (
  <div>
    <PageHeader
      title='Executives'
      description='Sub-logins under a staff account. Executives carry a subset of your permissions.'
      actions={
        <Can permission={GRANT.executive}>
          <CreateSubLogin kind='executive' />
        </Can>
      }
    />
    <SubLoginTable kind='executive' />
  </div>
)

export default ExecutivesList
