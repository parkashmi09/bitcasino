'use client'

import { useState, type ReactNode } from 'react'

import { useQuery } from '@tanstack/react-query'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import TxnCodeInput from '@/components/shared/TxnCodeInput'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { API_V1, ApiError, buildQuery, errorMessage } from '@/lib/api/client'
import type { Query } from '@/lib/api/types'

/**
 * Settlement screens (zip `pages/settlement/*`) ki common cheezein.
 * Sab API sports service ke `internalsettle` module me hain (zip `/api/internalsettle/*`).
 */

export const SETTLE_API = 'admin/sports/internalsettle'

/** Zip ka MARKETS_FOR_FANCY — inka result run/number se hota hai. */
export const MARKETS_FOR_FANCY = [
  '1st Innings 6 Overs Line', '2nd Innings 6 Overs Line', '3rd Innings 6 Overs Line',
  '1st Innings 50 Overs Line', '2nd Innings 50 Overs Line', '3rd Innings 50 Overs Line',
  '1st Innings 40 Overs Line', '2nd Innings 40 Overs Line', '3rd Innings 40 Overs Line',
  '1st Innings 30 Overs Line', '2nd Innings 30 Overs Line', '3rd Innings 30 Overs Line',
  '1st Innings 20 Overs Line', '2nd Innings 20 Overs Line', '3rd Innings 20 Overs Line',
  '1st Innings 10 Overs Line', '2nd Innings 10 Overs Line', '3rd Innings 10 Overs Line',
  'Over By Over', 'Ball By Ball', 'Normal', 'khado', 'meter', 'fancy1', 'oddeven'
]

/** "... Line" wale markets bhi run result wale hain (server ka helper/lineMarket.js jaisa). */
export const isRunResultMarket = (marketType?: string | null) =>
  MARKETS_FOR_FANCY.includes(String(marketType ?? '')) || /\bline$/i.test(String(marketType ?? '').trim())

/** Ek open bet (`GET internalsettle/open-bets`). */
export type OpenBet = {
  id: number | string
  userId?: number | string
  username?: string
  selectionName?: string
  betType?: string
  odds?: number | string
  stakeAmount?: number | string
  liability?: number | string
}

/**
 * Zip ka API call — poora response wapas (`{ success, data, windowHours, affectedUsers … }`).
 * Hamara `api` client sirf `data` deta hai, par zip ke screens upar wali keys bhi padhte hain.
 * success false ho to error throw.
 */
export async function zipCall<T = { data?: unknown }>(method: 'GET' | 'POST', path: string, payload?: Query | object): Promise<T> {
  const query = method === 'GET' ? buildQuery(payload as Query) : ''

  const res = await fetch(`${API_V1}/${path}${query}`, {
    method,
    headers: { accept: 'application/json', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
    body: method === 'POST' ? JSON.stringify(payload ?? {}) : undefined,
    cache: 'no-store'
  })

  const json = await res.json().catch(() => null)

  if (!res.ok || !json || json.success === false) {
    const err = json?.error

    const message =
      (err && typeof err === 'object' && typeof err.message === 'string' && err.message) ||
      (typeof err === 'string' && err) ||
      (typeof json?.message === 'string' && json.message) ||
      res.statusText ||
      'Request failed'

    // ApiError keeps `code` + 422 `details.fields`, so `errorMessage` can name the bad field.
    throw new ApiError(res.status, (err && typeof err === 'object' && typeof err.code === 'string' && err.code) || `HTTP_${res.status}`, message, err && typeof err === 'object' && err.details && typeof err.details === 'object' ? err.details : undefined)
  }

  return json as T
}

/**
 * Zip ka GET list — pehli baar load, `pollMs` ho to har itne ms me chupchaap refresh
 * (zip ka setInterval), aur Refresh button ke liye `refresh()` (tab 'Loading...' dikhta hai).
 */
export function useZipQuery<T>(path: string, query?: Query, pollMs?: number) {
  const [manual, setManual] = useState(false)
  const q = useQuery({ queryKey: ['zip', path, query ?? null], queryFn: () => zipCall<T>('GET', path, query), refetchInterval: pollMs })

  const refresh = async () => {
    setManual(true)

    try {
      await q.refetch()
    } finally {
      setManual(false)
    }
  }

  // A failed load must not look like "no rows": the screens show `error` (ErrorState).
  return { data: q.data, loading: q.isLoading || manual, error: q.error, refresh }
}

/** BACK / YES = neela, LAY / NO = laal. */
export const BetTypeBadge = ({ type }: { type?: string }) => {
  if (!type) return <span className='text-muted-foreground'>-</span>
  const isBack = ['back', 'yes', 'Yes'].includes(type)

  return <Badge variant={isBack ? 'default' : 'destructive'}>{type.toUpperCase()}</Badge>
}

export const fixed2 = (value: unknown) => (value == null || value === '' ? '-' : Number(value).toFixed(2))

/** Simple tab buttons (zip ke nav-tabs). */
export const TabBar = ({ tabs, active, onChange }: { tabs: { key: string; label: ReactNode }[]; active: string | null; onChange: (key: string) => void }) => (
  <div className='flex flex-wrap gap-1 border-b'>
    {tabs.map(tab => (
      <button
        key={tab.key}
        type='button'
        onClick={() => onChange(tab.key)}
        className={`-mb-px border-b-2 px-3 py-2 text-sm ${active === tab.key ? 'border-primary text-primary font-medium' : 'text-muted-foreground border-transparent'}`}
      >
        {tab.label}
      </button>
    ))}
  </div>
)

/**
 * "Per Bet" — ek market ki open bets, har bet ka "Void Bet" (zip ka void-single-bet).
 */
export const OpenBetsPanel = ({ title, bets, loading, onVoided }: { title: string; bets: OpenBet[]; loading: boolean; onVoided: () => void }) => {
  const [confirm, setConfirm] = useState<OpenBet | null>(null)
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState('')

  const voidBet = async () => {
    if (!confirm) return
    setBusy(true)

    try {
      await zipCall('POST', `${SETTLE_API}/void-single-bet`, { bet_id: confirm.id, transactionPassword: code })
      toast.success(`Bet #${confirm.id} voided for ${confirm.username || confirm.userId}`)
      setConfirm(null)
      onVoided()
    } catch (err) {
      // keep the dialog open so the admin can retry or cancel
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='bg-muted/40 p-3'>
      <div className='mb-2 flex items-center justify-between'>
        <strong className='text-sm'>Individual Bets — {title}</strong>
        <small className='text-muted-foreground'>
          {bets.length} bet{bets.length !== 1 ? 's' : ''}
        </small>
      </div>
      {loading ? (
        <div className='text-muted-foreground py-3 text-center text-sm'>Loading bets...</div>
      ) : bets.length === 0 ? (
        <div className='text-muted-foreground py-3 text-center text-sm'>No open bets found</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bet ID</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Selection</TableHead>
              <TableHead className='text-center'>Bet Type</TableHead>
              <TableHead className='text-right'>Odds</TableHead>
              <TableHead className='text-right'>Stake</TableHead>
              <TableHead className='text-right'>Liability</TableHead>
              <TableHead className='text-center'>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bets.map(bet => (
              <TableRow key={bet.id}>
                <TableCell>#{bet.id}</TableCell>
                <TableCell>{bet.username}</TableCell>
                <TableCell>{bet.selectionName || '-'}</TableCell>
                <TableCell className='text-center'>
                  <BetTypeBadge type={bet.betType} />
                </TableCell>
                <TableCell className='text-right'>{bet.odds ?? '-'}</TableCell>
                <TableCell className='text-right'>{fixed2(bet.stakeAmount)}</TableCell>
                <TableCell className='text-right'>{fixed2(bet.liability)}</TableCell>
                <TableCell className='text-center'>
                  <Button size='sm' variant='outline' onClick={() => setConfirm(bet)}>
                    Void Bet
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={Boolean(confirm)} onOpenChange={open => !open && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void Single Bet</DialogTitle>
          </DialogHeader>
          {confirm && (
            <div className='bg-warning-soft grid gap-2 rounded-md p-3 text-sm'>
              <p>
                Void bet <strong>#{confirm.id}</strong> for user <strong>{confirm.username}</strong>?
              </p>
              <p>
                Selection: <strong>{confirm.selectionName}</strong> · Stake: <strong>{Number(confirm.stakeAmount || 0).toFixed(2)}</strong> · Odds:{' '}
                <strong>{confirm.odds}</strong>
              </p>
              <p className='text-muted-foreground'>The stake will be refunded. This action cannot be undone.</p>
            </div>
          )}
          <TxnCodeInput id='vb-tp' value={code} onChange={setCode} />
          <DialogFooter>
            <Button variant='outline' onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button variant='destructive' disabled={busy || !code} onClick={voidBet}>
              {busy && <Loader2Icon className='animate-spin' />}
              {busy ? 'Processing...' : 'Confirm Void'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
