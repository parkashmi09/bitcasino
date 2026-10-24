'use client'

import { useState } from 'react'

import { HandCoinsIcon } from 'lucide-react'

import FormDialog from '@/components/shared/FormDialog'
import { TextField } from '@/components/shared/FormField'
import { Card } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { useSession } from '@/contexts/SessionContext'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { TxnPasswordLabel } from '@/views/finance/StaffFloat'

const PATH = 'admin/manual-payments'

type State = { deposit: boolean; withdraw: boolean; updatedAt: string | null; updatedBy: { id: string; name: string | null } | null }

/**
 * Transactions → Deposit / Withdraw → Manual ke upar Super Admin ka ON / OFF.
 * ON = direct user app se manual (bank transfer) deposit / withdrawal request bhej sakta hai;
 * OFF = mana (MANUAL_DEPOSIT_DISABLED / MANUAL_WITHDRAW_DISABLED). Agent ke users kabhi nahi.
 * Badalna sirf Super Admin (`wallet:adjust`), transaction password ke saath; baaki sirf dekhte hain.
 */
const ManualSwitch = ({ kind }: { kind: 'deposit' | 'withdraw' }) => {
  const { can } = useSession()
  const state = useApi<State>(PATH)
  const [next, setNext] = useState<boolean | null>(null)
  const [password, setPassword] = useState('')

  const save = useApiMutation({
    fn: () => api.put<State>(PATH, { [kind]: next, transactionPassword: password }),
    invalidate: [['api', PATH]],
    success: () => `Manual ${kind === 'deposit' ? 'deposits' : 'withdrawals'} switched ${next ? 'ON' : 'OFF'}`,
    onSuccess: () => {
      setNext(null)
      setPassword('')
    }
  })

  const on = state.data?.[kind] ?? true
  const word = kind === 'deposit' ? 'deposits' : 'withdrawals'

  return (
    <Card className={cn('mb-4 flex-row items-center gap-4 border px-4 py-3', on ? 'border-success/30' : 'border-danger/30')}>
      <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg', on ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger')}>
        <HandCoinsIcon className='size-5' />
      </span>
      <div className='min-w-0 flex-1'>
        <div className='font-semibold'>
          Manual {word} · <span className={on ? 'text-success' : 'text-danger'}>{on ? 'ON' : 'OFF'}</span>
        </div>
        <div className='text-muted-foreground text-xs'>
          {on
            ? `Direct users can submit manual (bank transfer) ${word} from the app. Agent users never can.`
            : `Direct users cannot submit manual ${word}. Pending ones below can still be decided.`}
          {state.data?.updatedBy && ` · last changed by ${state.data.updatedBy.name ?? `#${state.data.updatedBy.id}`}`}
        </div>
      </div>
      <Switch
        checked={on}
        disabled={!can('wallet:adjust') || state.isLoading}
        onCheckedChange={v => setNext(Boolean(v))}
        aria-label={`Manual ${word}`}
        title={can('wallet:adjust') ? undefined : 'Only Super Admin can change this'}
      />
      <FormDialog
        trigger={null}
        open={next !== null}
        onOpenChange={o => !o && setNext(null)}
        title={`Switch manual ${word} ${next ? 'ON' : 'OFF'}?`}
        description={next ? `Direct users will be able to submit manual ${word} again.` : `Direct users will not be able to submit manual ${word} until you switch it back on.`}
        submitLabel={next ? 'Switch ON' : 'Switch OFF'}
        destructive={next === false}
        validate={() => (password ? null : { transactionPassword: 'Transaction password is required' })}
        onSubmit={() => save.mutateAsync()}
      >
        <TextField id={`manual-${kind}-tp`} name='transactionPassword' label={<TxnPasswordLabel />} type='password' value={password} onChange={e => setPassword(e.target.value)} />
      </FormDialog>
    </Card>
  )
}

export default ManualSwitch
