'use client'

import { useState } from 'react'

import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useApi } from '@/hooks/use-api'
import { api, errorMessage } from '@/lib/api/client'

const LOCK_API = 'admin/sports/config/betlock'

type LockRow = { id: number | string; username?: string; name?: string; type: string; is_locked: boolean }

type Props = {
  eventId: string
  market: { mid: string | number; mname: string } | null
  onClose: () => void
}

/**
 * Bet Lock — zip ka `components/BetLockModal.jsx`.
 *
 * Market pe direct children ki list, har ek ka checkbox. Tick hi action hai (Submit nahi):
 * Transaction Code khali ho to kuch nahi bhejte. Upar wala checkbox = sab ek saath.
 */
const BetLockDialog = ({ eventId, market, onClose }: Props) => {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  const params = market ? { market_id: String(market.mid), market_name: market.mname } : undefined
  const { data, refetch, isLoading, error } = useApi<LockRow[]>(market ? `${LOCK_API}/market-locks/${eventId}` : null, params)
  const rows = data ?? []
  const allLocked = rows.length > 0 && rows.every(r => r.is_locked)

  // Transaction Code zaroori — warna toast, box nahi hilta
  const guard = () => {
    if (code.trim()) return true
    toast.error('Transaction Code is required')

    return false
  }

  // ek call, phir toast, phir list dobara server se
  const run = async (body: Record<string, unknown>, url: string, locked: boolean) => {
    if (!guard() || !market) return
    setBusy(true)

    try {
      await api.post(`${LOCK_API}/${url}`, { event_id: eventId, market_id: String(market.mid), market_name: market.mname, is_locked: locked, transactionPassword: code, ...body })
      const who = 'accounts' in body ? 'All accounts' : (rows.find(r => r.id === body.account_id)?.username ?? 'User')

      toast.success(`${who} ${locked ? 'locked' : 'unlocked'} on ${market.mname}`)
      await refetch()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const toggleOne = (row: LockRow) => run({ account_id: row.id, account_type: row.type }, 'toggle-market-lock', !row.is_locked)

  const toggleAll = () =>
    run({ accounts: rows.map(r => ({ account_id: r.id, account_type: r.type })) }, 'bulk-toggle-market-lock', !allLocked)

  return (
    <Dialog open={Boolean(market)} onOpenChange={open => !open && onClose()}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Bet Lock</DialogTitle>
        </DialogHeader>
        {busy && (
          <div className='bg-background/50 absolute inset-0 z-10 flex items-center justify-center rounded-xl'>
            <Loader2Icon className='size-6 animate-spin' />
          </div>
        )}
        <div className='grid grid-cols-2 gap-2'>
          <div />
          <Input type='password' placeholder='Transaction Code' value={code} onChange={e => setCode(e.target.value)} autoComplete='off' />
        </div>
        <div className='max-h-[60vh] overflow-auto rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='w-10'>
                  <Checkbox checked={allLocked} onCheckedChange={() => void toggleAll()} disabled={isLoading || !rows.length} aria-label='Lock all' />
                </TableHead>
                <TableHead>All Account</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && !rows.length ? (
                <TableRow>
                  <TableCell colSpan={2} className='text-center'>
                    Loading...
                  </TableCell>
                </TableRow>
              ) : error && !rows.length ? (
                <TableRow>
                  <TableCell colSpan={2} className='text-destructive text-center'>
                    Could not load accounts: {errorMessage(error)}
                  </TableCell>
                </TableRow>
              ) : !rows.length ? (
                <TableRow>
                  <TableCell colSpan={2} className='text-center'>
                    No accounts found
                  </TableCell>
                </TableRow>
              ) : (
                rows.map(row => (
                  <TableRow key={`${row.type}_${row.id}`}>
                    <TableCell>
                      <Checkbox checked={row.is_locked} onCheckedChange={() => void toggleOne(row)} aria-label={`Lock ${row.username ?? row.id}`} />
                    </TableCell>
                    <TableCell>{row.username || row.name || row.id}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default BetLockDialog
