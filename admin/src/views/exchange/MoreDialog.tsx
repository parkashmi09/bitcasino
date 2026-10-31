'use client'

import { useState, type ReactNode } from 'react'

import { Loader2Icon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import CreditHistory from './CreditHistory'
import { fmt, SETTLE_INVALIDATE } from './accountMoney'
import type { AccountRow } from './types'

const info = (rows: [string, ReactNode][]) => (
  <table className='w-full text-sm'>
    <tbody>
      {rows.map(([k, v]) => (
        <tr key={k} className='border-b last:border-0'>
          <th className='text-muted-foreground py-1.5 pr-3 text-left font-normal'>{k}</th>
          <td className='py-1.5'>{v}</td>
        </tr>
      ))}
    </tbody>
  </table>
)

/** Profile tab — zip ka "Partnership Information" + "Additional Information". */
const ProfileTab = ({ row }: { row: AccountRow }) => (
  <div className='grid gap-4 md:grid-cols-2'>
    <div className='grid gap-2'>
      <div className='flex items-center gap-3'>
        <span className='bg-primary/10 text-primary flex size-10 items-center justify-center rounded-full font-semibold uppercase'>{row.username.charAt(0)}</span>
        <div>
          <div className='font-medium'>{row.username}</div>
          <div className='text-muted-foreground text-xs'>{row.phone || ''}</div>
        </div>
      </div>
      <h4 className='mt-2 text-sm font-semibold'>Partnership Information</h4>
      {info([
        ['Partnership Name:', 'Point'],
        ['User Part:', 0],
        ['Our Part:', row.percentage ?? 0],
        ['Remark:', 'NA']
      ])}
    </div>
    <div className='grid content-start gap-2'>
      <h4 className='text-sm font-semibold'>Additional Information</h4>
      {info([
        ['User Name:', row.username],
        ['Email:', row.email || ''],
        ['Mobile Number:', row.phone || ''],
        ['City:', row.city || ''],
        ['Credit pts:', fmt(row.credit)],
        ['pts:', fmt(row.allPoint)],
        ['Client P/L:', fmt(row.settlementPoints)],
        ['Exposure:', fmt(row.exposure)],
        ['Sports pts:', fmt(row.sportsPts)],
        ['Casino pts:', fmt(row.casinoPts)],
        ['Original pts:', fmt(row.originalPts)],
        ['Created Date :', row.createdAt ? new Date(row.createdAt).toLocaleString() : '']
      ])}
    </div>
  </div>
)

/** Change Password — Password, Confirm Password, Transaction Code (hamara admin/accounts/password). */
const PasswordTab = ({ row, onDone }: { row: AccountRow; onDone: () => void }) => {
  const [form, setForm] = useState({ password: '', confirm: '', txn: '' })
  const [error, setError] = useState('')

  const save = useApiMutation({
    fn: () =>
      api.post('admin/accounts/password', {
        accountType: row.accountType,
        accountId: Number(row.accountId),
        newPassword: form.password,
        transactionPassword: form.txn
      }),
    success: `Password changed for ${row.username}`,
    onSuccess: onDone
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!form.password) return setError('The Password field is required')

    // Server (`lords.validators.js setPassword`): 8–200 characters.
    if (form.password.length < 8) return setError('The Password must be at least 8 characters')
    if (form.password.length > 200) return setError('The Password must be at most 200 characters')
    if (form.password !== form.confirm) return setError('The Confirm Password confirmation does not match')
    if (!form.txn) return setError('The Transaction Code field is required')
    void save.mutateAsync().catch(() => {})
  }

  return (
    <form onSubmit={submit} className='grid gap-3'>
      {(
        [
          ['Password', 'password'],
          ['Confirm Password', 'confirm'],
          ['Transaction Code', 'txn']
        ] as const
      ).map(([label, key]) => (
        <div key={key} className='grid grid-cols-3 items-center gap-2'>
          <Label>{label}</Label>
          <Input className='col-span-2' type='password' placeholder={label} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} />
        </div>
      ))}
      {error && <div className='text-destructive text-right text-sm'>{error}</div>}
      <div className='text-right'>
        <Button type='submit' disabled={save.isPending}>
          {save.isPending && <Loader2Icon className='animate-spin' />}
          submit
        </Button>
      </div>
    </form>
  )
}

/** User Lock — Bet lock, User lock, Transaction Code (hamara admin/accounts/status). */
const LockTab = ({ row, onDone }: { row: AccountRow; onDone: () => void }) => {
  const [betLock, setBetLock] = useState(row.betLocked)
  const [userLock, setUserLock] = useState(row.userLocked)
  const [txn, setTxn] = useState('')
  const [error, setError] = useState('')

  const save = useApiMutation({
    fn: () =>
      api.post('admin/accounts/status', {
        accountType: row.accountType,
        accountId: Number(row.accountId),
        betStatus: betLock ? 'suspended' : 'active',
        status: userLock ? 'suspended' : 'active',
        transactionPassword: txn
      }),
    invalidate: SETTLE_INVALIDATE,
    success: () => `${row.username}: bet ${betLock ? 'locked' : 'unlocked'}, user ${userLock ? 'locked' : 'unlocked'}`,
    onSuccess: onDone
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!txn) return setError('The Transaction Code field is required')
    setError('')
    void save.mutateAsync().catch(() => {})
  }

  return (
    <form onSubmit={submit} className='grid gap-3'>
      <div className='grid grid-cols-3 items-center gap-2'>
        <Label>Bet lock</Label>
        <Switch checked={betLock} onCheckedChange={v => setBetLock(Boolean(v))} />
      </div>
      <div className='grid grid-cols-3 items-center gap-2'>
        <Label>User lock</Label>
        <Switch checked={userLock} onCheckedChange={v => setUserLock(Boolean(v))} />
      </div>
      <div className='grid grid-cols-3 items-center gap-2'>
        <Label>Transaction Code</Label>
        <Input className='col-span-2' type='password' placeholder='Transaction Code' value={txn} onChange={e => setTxn(e.target.value)} />
      </div>
      {error && <div className='text-destructive text-right text-sm'>{error}</div>}
      <div className='text-right'>
        <Button type='submit' disabled={save.isPending}>
          {save.isPending && <Loader2Icon className='animate-spin' />}
          submit
        </Button>
      </div>
    </form>
  )
}

const TABS = [
  { key: 'profile', label: 'Profile' },
  { key: 'password', label: 'Change Password' },
  { key: 'lock', label: 'User Lock' },
  { key: 'history', label: 'Credit History' }
] as const

/**
 * More — zip ka `components/MoreModal.jsx`: account ki poori jaankari, password, lock, credit history.
 * Drill-down list me bhi yahi window ("P" button).
 */
type MoreDialogProps = {
  row: AccountRow

  /** Button jo popup kholta hai (drill-down ka "P", list ka More icon). */
  trigger: ReactNode
}

const MoreDialog = ({ row, trigger }: MoreDialogProps) => {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('profile')
  const close = () => setOpen(false)

  return (
    <>
      <span
        role='button'
        tabIndex={0}
        onClick={() => {
          setTab('profile')
          setOpen(true)
        }}
      >
        {trigger}
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='sm:max-w-3xl'>
          <DialogHeader>
            <DialogTitle className='uppercase'>{row.username}</DialogTitle>
          </DialogHeader>
          <div className='flex flex-wrap gap-1 border-b'>
            {TABS.map(t => (
              <button
                key={t.key}
                type='button'
                onClick={() => setTab(t.key)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t.key ? 'border-primary text-primary font-medium' : 'text-muted-foreground border-transparent'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {tab === 'profile' && <ProfileTab row={row} />}
          {tab === 'password' && <PasswordTab row={row} onDone={close} />}
          {tab === 'lock' && <LockTab row={row} onDone={close} />}
          {tab === 'history' && <CreditHistory row={row} />}
        </DialogContent>
      </Dialog>
    </>
  )
}

export default MoreDialog
