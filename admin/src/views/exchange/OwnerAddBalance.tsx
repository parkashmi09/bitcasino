'use client'

import { useState } from 'react'

import FormDialog from '@/components/shared/FormDialog'
import { formatIn, useReportMoney } from '@/components/shared/ReportMoney'
import { SelectField, TextAreaField, TextField } from '@/components/shared/FormField'
import { siteConfig } from '@/configs/site'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { check } from '@/lib/validate'
import { TxnPasswordLabel } from '@/views/finance/StaffFloat'
import type { OwnerWallet } from './types'

/** Owner ke do balance: Agent System (`credits`) aur Direct Users (`staff_balances`). */
type Target = 'client' | 'direct' | 'move'

const TARGETS: Record<Target, { label: string; path: string; note: string }> = {
  client: {
    label: 'Agent System balance',
    path: 'admin/exchange/owner/add-balance',
    note: 'Used only for your staff, agents and their players.'
  },
  direct: {
    label: 'Direct Users balance',
    path: 'admin/exchange/owner/add-direct-balance',
    note: 'Used only for direct users (signed up on the site, no parent).'
  },
  move: {
    label: 'Agent System balance',
    path: 'admin/exchange/owner/move-to-agent-system',
    note: 'Moves money from your Direct Users balance (what the parent site sent you) to your Agent System balance, which pays your agents.'
  }
}

// Whitelabel company: khud add nahi kar sakti — sirf Direct (parent ka bheja) se Agent System me le jaati hai.
const SHOWN: Target[] = siteConfig.whitelabel ? ['move'] : ['client', 'direct']
const TITLE = siteConfig.whitelabel ? 'Move to Agent System' : 'Add Balance'

/**
 * "Add Balance" — zip (tenexch bundle) ka OwnerAddBalanceModal: Current Balance, Amount,
 * Remark, Transaction Code. Sirf owner apne wallet me paisa daalta hai.
 * Owner chunta hai kaunse balance me: Agent System ya Direct Users.
 * Header ke profile menu se khulta hai (alag page nahi).
 */
const OwnerAddBalance = ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => {
  const [target, setTarget] = useState<Target>(SHOWN[0])
  const [form, setForm] = useState({ amount: '', note: '', transactionPassword: '' })

  // Current Balance — dialog khula ho tabhi mangwao
  const { data, error } = useApi<OwnerWallet>(open ? 'admin/exchange/owner/wallet' : null)
  const current = data ? (target === 'client' ? data.wallet.balance : data.directBalance) : null

  // Direct balance owner ki default coin (e.g. USDT) me: dikhe bhi usi me, server INR me badal ke save kare.
  const money = useReportMoney()
  const coin = target === 'direct' ? money.code : 'INR'
  const coinPerInr = coin !== 'INR' && Number(form.amount) > 0 ? money.convert(1, 'INR') : null
  const shownCurrent = current === null ? null : target === 'direct' ? money.format(current, 'INR') : Number(current).toLocaleString()

  const add = useApiMutation({
    fn: () =>
      api.post(TARGETS[target].path, {
        amount: form.amount,
        ...(coin !== 'INR' ? { currency: coin } : {}),
        ...(form.note ? { note: form.note } : {}),
        transactionPassword: form.transactionPassword
      }),
    invalidate: [['api', 'admin/exchange/owner/wallet'], ['api', 'admin/exchange/dashboard'], ['api', 'admin/exchange/user-reports/home'], ['api', 'admin/accounts/float'], ['api', 'admin/exchange/accounts'], ['paged', 'admin/exchange/owner/direct-ledger']],
    success: () => `${coin === 'INR' ? Number(form.amount).toLocaleString() : formatIn(Number(form.amount), coin)} ${target === 'move' ? 'moved' : 'added'} to your ${TARGETS[target].label}`,
    onSuccess: () => setForm({ amount: '', note: '', transactionPassword: '' })
  })

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      trigger={null}
      title={TITLE}
      description={
        siteConfig.whitelabel
          ? 'Your Direct Users balance is what the parent site sent you. Move part of it to Agent System to give balance to your agents.'
          : 'You have two balances. Agent System pays your staff, agents and their players. Direct Users pays direct users only.'
      }
      submitLabel={TITLE}

      // Server (`ownerAddBalance`): amount > 0 with ≤ 2 decimals, note ≤ 200, transaction password required.
      validate={() => ({
        'ob-amount': check.number(form.amount, 'Amount', { positive: true, decimals: 2 }),
        'ob-note': check.length(form.note, 'Remark', { max: 200 }),
        'ob-tp': check.required(form.transactionPassword, 'Transaction code')
      })}
      onSubmit={() => add.mutateAsync()}
    >
      {SHOWN.length > 1 ? (
        <SelectField
          id='ob-target'
          label='Add to'
          value={target}
          onChange={v => setTarget(v as Target)}
          options={SHOWN.map(k => ({ value: k, label: TARGETS[k].label }))}
          hint={TARGETS[target].note}
        />
      ) : (
        <p className='text-muted-foreground text-sm'>{TARGETS[target].note}</p>
      )}
      <TextField id='ob-current' label={target === 'move' ? 'Direct Users balance' : 'Current Balance'} readOnly disabled value={shownCurrent ?? (error ? 'Could not load' : '…')} />
      <TextField
        id='ob-amount'
        label={coin === 'INR' ? 'Amount' : `Amount (${coin})`}
        required
        placeholder={coin === 'INR' ? 'Amount' : `Amount in ${coin}`}
        value={form.amount}
        onChange={e => setForm({ ...form, amount: e.target.value })}
        hint={coinPerInr ? `Saved in INR at the current rate: ≈ ${formatIn(Number(form.amount) / coinPerInr, 'INR')}` : undefined}
      />
      <TextAreaField id='ob-note' label='Remark (optional)' maxLength={200} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
      <TextField
        id='ob-tp'
        label={<TxnPasswordLabel />}
        type='password'
        required
        value={form.transactionPassword}
        onChange={e => setForm({ ...form, transactionPassword: e.target.value })}
      />
    </FormDialog>
  )
}

export default OwnerAddBalance
