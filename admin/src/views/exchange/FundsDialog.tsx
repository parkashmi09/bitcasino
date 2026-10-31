'use client'

import { useState } from 'react'

import { Loader2Icon, MinusIcon, PlusIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { TxnPasswordLabel } from '@/views/finance/StaffFloat'
import { fmt, SETTLE_INVALIDATE, settleApi } from './accountMoney'
import type { AccountRow, AccountsResponse } from './types'

/** `dw` = simple Deposit / Withdraw (credit), `settle` = Settlement (points). */
export type FundsKind = 'dw' | 'settle'

/** Amount me sirf number aur ek point (zip jaisa). */
const cleanAmount = (v: string) => v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')

const Stat = ({ label, value, tone }: { label: string; value: string | number; tone: string }) => (
  <div className={`rounded-lg px-3 py-2 ${tone}`}>
    <div className='truncate text-xs opacity-80'>{label}</div>
    <div className='text-lg font-semibold tabular-nums'>{fmt(value)}</div>
  </div>
)

/**
 * Account List ka Deposit / Withdraw aur Settlement popup — zip ke wallet page jaisa:
 * Amount + Transaction Code, phir "− Withdraw" (laal) aur "+ Deposit" (hara) button.
 *   dw     → `admin/staff/transfer` (parent ke balance se credit deta / wapas leta)
 *   settle → `admin/exchange/points/settle` (Client P/L settle; withdraw = points negative)
 */
const FundsForm = ({ kind, row, me, onDone }: { kind: FundsKind; row: AccountRow; me: AccountsResponse['me']; onDone: () => void }) => {
  const [amount, setAmount] = useState('')
  const [remark, setRemark] = useState('')
  const [password, setPassword] = useState('')

  const run = useApiMutation<'deposit' | 'withdraw'>({
    fn: direction =>
      kind === 'dw'
        ? api.post('admin/staff/transfer', {
            toType: row.accountType,
            toId: Number(row.accountId),
            amount: Number(amount).toFixed(2),
            direction,
            transactionPassword: password
          })
        : settleApi(row, direction === 'deposit' ? Number(amount) : -Number(amount), password, remark),
    invalidate: SETTLE_INVALIDATE,
    success: (_r, direction) => `${direction === 'deposit' ? 'Deposited' : 'Withdrawn'} ${amount} ${direction === 'deposit' ? 'to' : 'from'} ${row.username}`,
    onSuccess: onDone
  })

  const ready = Number(amount) > 0 && password.length > 0 && !run.isPending

  // Owner ↔ direct user ka settle owner ke Direct Users balance se hota hai.
  const parentBal = kind === 'settle' && row.isDirectUser ? Number(me.directBalance ?? 0) : Number(me.balance)

  return (
    <div className='grid gap-4'>
      <div className={`grid gap-2 ${kind === 'settle' ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <Stat label={me.username} value={parentBal} tone='bg-info-soft text-info' />
        {kind === 'dw' ? (
          <Stat label={`${row.username} CR`} value={row.credit} tone='bg-warning-soft text-warning' />
        ) : (
          <>
            <Stat label={row.username} value={row.available} tone='bg-warning-soft text-warning' />
            <Stat label='Profit/Loss' value={row.settlementPoints} tone='bg-success-soft text-success' />
          </>
        )}
      </div>

      <div className='grid gap-1.5'>
        <Label htmlFor='funds-amount'>Amount</Label>
        <Input id='funds-amount' autoFocus inputMode='decimal' placeholder='Amount' className='h-11 text-lg' value={amount} onChange={e => setAmount(cleanAmount(e.target.value))} />
      </div>
      {kind === 'settle' && (
        <div className='grid gap-1.5'>
          <Label htmlFor='funds-remark'>Remark</Label>
          <Input id='funds-remark' placeholder='Remark' value={remark} onChange={e => setRemark(e.target.value)} />
        </div>
      )}
      <div className='grid gap-1.5'>
        <Label htmlFor='funds-tp'>
          <TxnPasswordLabel />
        </Label>
        <Input id='funds-tp' type='password' autoComplete='off' value={password} onChange={e => setPassword(e.target.value)} />
      </div>

      <div className='grid grid-cols-2 gap-3'>
        <Button className='bg-danger hover:bg-danger/90 h-11 text-white' disabled={!ready} onClick={() => run.mutate('withdraw')}>
          {run.isPending && run.variables === 'withdraw' ? <Loader2Icon className='animate-spin' /> : <MinusIcon />} Withdraw
        </Button>
        <Button className='bg-success hover:bg-success/90 h-11 text-white' disabled={!ready} onClick={() => run.mutate('deposit')}>
          {run.isPending && run.variables === 'deposit' ? <Loader2Icon className='animate-spin' /> : <PlusIcon />} Deposit
        </Button>
      </div>
    </div>
  )
}

type Props = { kind: FundsKind; row: AccountRow; me: AccountsResponse['me']; open: boolean; onOpenChange: (open: boolean) => void }

const FundsDialog = ({ kind, row, me, open, onOpenChange }: Props) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className='sm:max-w-md'>
      <DialogHeader>
        <DialogTitle>{kind === 'dw' ? 'Deposit / Withdraw' : 'Settlement'}</DialogTitle>
        <DialogDescription>{row.username}</DialogDescription>
      </DialogHeader>
      {open && <FundsForm kind={kind} row={row} me={me} onDone={() => onOpenChange(false)} />}
    </DialogContent>
  </Dialog>
)

export default FundsDialog
