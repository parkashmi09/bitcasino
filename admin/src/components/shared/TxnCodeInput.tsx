'use client'

import { Input } from '@/components/ui/input'
import { TxnPasswordLabel } from '@/views/finance/StaffFloat'

/**
 * The transaction code inside a confirm popup of a balance move (forfeit, P2P release / cancel,
 * sports settle / void). The backend refuses the move without it (`requireTxnPassword`).
 */
const TxnCodeInput = ({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) => (
  <div className='grid gap-2'>
    <label htmlFor={id} className='text-foreground text-sm font-medium'>
      <TxnPasswordLabel />
    </label>
    <Input id={id} type='password' autoComplete='new-password' value={value} onChange={e => onChange(e.target.value)} />
  </div>
)

export default TxnCodeInput
