'use client'

import { Fragment, useState } from 'react'

import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import PageHeader from '@/components/shared/PageHeader'
import TxnCodeInput from '@/components/shared/TxnCodeInput'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { errorMessage } from '@/lib/api/client'
import { check } from '@/lib/validate'
import { isRunResultMarket, MARKETS_FOR_FANCY, OpenBetsPanel, SETTLE_API, TabBar, useZipQuery, zipCall, type OpenBet } from './shared'

/** `GET internalsettle/fanmatches` → `{ [marketType]: FancyRow[] }` */
type FancyRow = {
  matchId: string
  eventId: string
  eventName?: string
  matchTitle?: string
  marketType?: string
  gameType?: string
  selectionName?: string
  totalBets?: number
  counts?: number
  teamOne?: string
  teamTwo?: string
  bets?: { runners?: string[]; teamOne?: string; teamTwo?: string }[]
}

// Har tab apni list client-side page karta hai.
const PAGE_SIZE = 25

/** Tabs ka order: zip ki list wala pehle, phir 'others', phir baaki. */
function orderedTabKeys(data: Record<string, FancyRow[]>) {
  const withData = Object.keys(data).filter(k => Array.isArray(data[k]) && data[k].length > 0)
  const ordered = MARKETS_FOR_FANCY.filter(name => withData.includes(name))

  if (withData.includes('others')) ordered.push('others')
  for (const k of withData) if (!ordered.includes(k)) ordered.push(k)

  return ordered
}

/**
 * Declare / Void — zip ka `components/FancySettlementModal.jsx`.
 *   run wale market   → Winner id (number)
 *   fancy1 / oddeven  → Yes / No
 *   baaki (2+ runner) → team chuno
 */
const FancyModal = ({ mode, row, onClose }: { mode: 'declare' | 'void'; row: FancyRow; onClose: () => void }) => {
  const [winnerId, setWinnerId] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [code, setCode] = useState('')

  const marketType = row.marketType ?? ''
  const matchTitle = row.eventName || row.matchTitle || ''
  const counts = row.counts ?? 1
  const firstBet = row.bets?.[0]
  const runners = firstBet?.runners ?? null
  const useTeamSelection = mode === 'declare' && !isRunResultMarket(marketType) && counts >= 2
  const isBinaryFancy = mode === 'declare' && ['fancy1', 'oddeven'].includes(marketType)
  const isThreeWay = counts >= 3
  const teamOne = row.teamOne || firstBet?.teamOne || 'Team 1'
  const teamTwo = row.teamTwo || firstBet?.teamTwo || 'Team 2'

  // Run markets settle on a run count — a whole number, 0 or more.
  const winnerError = mode === 'declare' && !useTeamSelection && !isBinaryFancy && isRunResultMarket(marketType) && winnerId.trim() !== '' ? check.number(winnerId, 'Winner id', { integer: true, min: 0 }) : undefined

  const submit = async () => {
    if (winnerError) {
      toast.error(winnerError)

      return
    }

    setSubmitting(true)

    try {
      if (mode === 'void') {
        await zipCall('POST', `${SETTLE_API}/void`, {
          eventid: row.eventId,
          match_id: row.matchId,
          market_type: marketType,
          gametype: row.gameType || 'FAN',
          ...(isRunResultMarket(marketType) ? { selection_name: row.selectionName } : {}),
          transactionPassword: code
        })
      } else {
        const common = { eventid: row.eventId, match_id: row.matchId, match_title: row.matchTitle, game_type: row.gameType || 'FAN', market_type: marketType }

        const payload = useTeamSelection
          ? { ...common, winnerName: selected }
          : ['fancy1', 'oddeven'].includes(marketType)
            ? { ...common, winnerName: winnerId.trim(), fancyName: row.selectionName }
            : isRunResultMarket(marketType)
              ? { ...common, winnerId: winnerId.trim(), fancyName: row.selectionName }
              : { ...common, winnerName: winnerId.trim() }

        await zipCall('POST', `${SETTLE_API}/declareresult`, { ...payload, transactionPassword: code })
      }

      toast.success(mode === 'void' ? `${marketType || 'Market'} voided — stakes refunded` : `Result declared for ${row.selectionName || marketType || matchTitle}`)
      onClose()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSubmitting(false)
    }
  }

  const outcome = (label: string) => (
    <Button key={label} type='button' variant={selected === label ? 'default' : 'outline'} className='m-1 min-w-[110px] font-bold' onClick={() => setSelected(label)}>
      {label}
    </Button>
  )

  const ready = useTeamSelection ? selected != null : winnerId.trim() !== ''
  const disabled = !code || (mode === 'declare' && (!ready || Boolean(winnerError))) || submitting

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'void' ? 'Void Match' : 'Declare Result'}</DialogTitle>
        </DialogHeader>
        <div className='text-center font-bold'>{marketType ? `${marketType} — ${matchTitle}` : matchTitle}</div>

        {mode === 'declare' && useTeamSelection && (
          <>
            <div className='flex flex-wrap items-center justify-center'>
              {runners && runners.length > 0
                ? runners.map(r => outcome(r))
                : isThreeWay
                  ? [teamOne, 'Draw', teamTwo].map(r => outcome(r))
                  : [teamOne, teamTwo].map((r, i) => (
                      <span key={r} className='inline-flex items-center'>
                        {i > 0 && <span className='text-muted-foreground mx-2'>VS</span>}
                        {outcome(r)}
                      </span>
                    ))}
            </div>
            <div className='text-center text-sm'>
              {selected != null ? (
                <>
                  Result: <strong>{selected}</strong>
                </>
              ) : (
                <span className='text-muted-foreground'>
                  {runners?.length ? 'Select a runner' : isThreeWay ? 'Select Team 1, Draw, or Team 2' : 'Select winner'}
                </span>
              )}
            </div>
          </>
        )}

        {mode === 'declare' && !useTeamSelection && (
          <div className='grid gap-2'>
            <Label className='font-bold'>{isBinaryFancy ? 'Winner Name' : 'Winner id'}</Label>
            {isBinaryFancy ? (
              <div className='flex gap-2'>
                {['Yes', 'No'].map(v => (
                  <Button key={v} type='button' className='flex-1' variant={winnerId === v ? 'default' : 'outline'} onClick={() => setWinnerId(v)}>
                    {v}
                  </Button>
                ))}
              </div>
            ) : (
              <>
                <Input value={winnerId} onChange={e => setWinnerId(e.target.value)} placeholder='Enter winner id' aria-invalid={winnerError ? true : undefined} autoFocus />
                {winnerError && <p className='text-destructive text-sm'>{winnerError}</p>}
              </>
            )}
          </div>
        )}

        {mode === 'void' && (
          <div className='bg-warning-soft rounded-md p-3 text-sm'>
            Do you really want to cancel or refund the bets? All stakes will be refunded to the users. This action cannot be undone.
          </div>
        )}

        <TxnCodeInput id='fs-tp' value={code} onChange={setCode} />

        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            Cancel
          </Button>
          <Button variant={mode === 'void' ? 'destructive' : 'default'} disabled={disabled} onClick={submit}>
            {submitting && <Loader2Icon className='animate-spin' />}
            {submitting ? 'Submitting...' : mode === 'void' ? 'Confirm Void' : 'Submit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Fancy Settlement — zip ka `pages/settlement/FancySettlement.jsx`.
 * Har market type ka apna tab, har 2 second me refresh, Declare / Void / Per Bet.
 */
const FancySettlement = () => {
  const [chosenTab, setActiveTab] = useState<string | null>(null)
  const [pageByTab, setPageByTab] = useState<Record<string, number>>({})
  const [modal, setModal] = useState<{ mode: 'declare' | 'void'; row: FancyRow } | null>(null)

  const [expanded, setExpanded] = useState<string | null>(null)
  const [openBets, setOpenBets] = useState<OpenBet[]>([])
  const [betsLoading, setBetsLoading] = useState(false)

  // Har 2 second me list dobara (zip jaisa).
  const list = useZipQuery<{ data?: Record<string, FancyRow[]> }>(`${SETTLE_API}/fanmatches`, undefined, 2000)
  const data = list.data?.data && typeof list.data.data === 'object' ? list.data.data : {}
  const tabKeys = orderedTabKeys(data)
  const loading = list.loading
  const fetchFancy = list.refresh

  // Chuna hua tab khaali ho gaya to pehla tab.
  const activeTab = chosenTab && tabKeys.includes(chosenTab) ? chosenTab : (tabKeys[0] ?? null)

  const rows = activeTab && Array.isArray(data[activeTab]) ? data[activeTab] : []

  // Declare/void ke baad tab chhota ho jaata hai — page aakhri asli page tak hi.
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const currentPage = Math.min(pageByTab[activeTab ?? ''] || 1, totalPages)
  const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const withMarket = (row: FancyRow) => ({ ...row, marketType: row.marketType || activeTab || '' })
  const keyOf = (row: FancyRow) => `${row.matchId}-${row.marketType || activeTab}-${row.gameType}-${row.selectionName || ''}`

  const toggleBets = async (row: FancyRow) => {
    const key = keyOf(row)

    if (expanded === key) {
      setExpanded(null)
      setOpenBets([])

      return
    }

    setExpanded(key)
    setBetsLoading(true)

    try {
      const res = await zipCall<{ data?: OpenBet[] }>('GET', `${SETTLE_API}/open-bets`, {
        match_id: row.matchId,
        market_type: row.marketType || activeTab || '',
        game_type: row.gameType || 'FAN',
        selection_name: row.selectionName || undefined
      })

      setOpenBets(res.data ?? [])
    } catch (e) {
      setOpenBets([])
      toast.error(`Could not load open bets: ${errorMessage(e)}`)
    } finally {
      setBetsLoading(false)
    }
  }

  const runColumn = isRunResultMarket(activeTab)

  return (
    <div>
      <PageHeader title='Fancy Settlement' />
      <Card className='shadow-none'>
        <CardContent className='grid gap-3'>
          <div className='flex items-start justify-between gap-2'>
            <TabBar
              tabs={tabKeys.map(k => ({ key: k, label: k }))}
              active={activeTab}
              onChange={key => {
                setActiveTab(key)
                setExpanded(null)
              }}
            />
            <Button size='sm' disabled={loading} onClick={fetchFancy}>
              {loading ? 'Loading...' : 'Refresh'}
            </Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Match Title</TableHead>
                <TableHead>{runColumn ? 'Market Name' : 'Market Type'}</TableHead>
                <TableHead className='text-right'>Total Bets</TableHead>
                <TableHead className='min-w-[240px] text-center'>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={4} className='text-center'>
                    Loading...
                  </TableCell>
                </TableRow>
              ) : list.error && !list.data ? (
                <TableRow>
                  <TableCell colSpan={4} className='text-destructive text-center'>
                    Could not load fancy markets: {errorMessage(list.error)}
                  </TableCell>
                </TableRow>
              ) : pageRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className='text-center'>
                    No matches found
                  </TableCell>
                </TableRow>
              ) : (
                pageRows.map((row, i) => (
                  <Fragment key={`${row.matchId}-${row.eventId}-${i}`}>
                    <TableRow>
                      <TableCell className='font-bold'>{row.eventName || row.matchTitle || '-'}</TableCell>
                      <TableCell>{runColumn ? row.selectionName || '-' : (row.marketType ?? activeTab ?? '-')}</TableCell>
                      <TableCell className='text-right'>{row.totalBets ?? 0}</TableCell>
                      <TableCell className='text-center'>
                        <div className='flex justify-center gap-1'>
                          <Button size='sm' onClick={() => setModal({ mode: 'declare', row: withMarket(row) })}>
                            Declare
                          </Button>
                          <Button size='sm' variant='secondary' onClick={() => setModal({ mode: 'void', row: withMarket(row) })}>
                            Void
                          </Button>
                          <Button size='sm' variant='outline' onClick={() => toggleBets(row)}>
                            {expanded === keyOf(row) ? 'Hide' : 'Per Bet'}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {expanded === keyOf(row) && (
                      <TableRow>
                        <TableCell colSpan={4} className='p-0'>
                          <OpenBetsPanel
                            title={row.selectionName || row.marketType || activeTab || ''}
                            bets={openBets}
                            loading={betsLoading}
                            onVoided={() => {
                              void fetchFancy()
                              setExpanded(null)
                              setOpenBets([])
                            }}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))
              )}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <div className='flex items-center justify-end gap-2 text-sm'>
              <Button size='sm' variant='outline' disabled={currentPage <= 1} onClick={() => setPageByTab(p => ({ ...p, [activeTab ?? '']: currentPage - 1 }))}>
                Prev
              </Button>
              <span>
                {currentPage} / {totalPages}
              </span>
              <Button size='sm' variant='outline' disabled={currentPage >= totalPages} onClick={() => setPageByTab(p => ({ ...p, [activeTab ?? '']: currentPage + 1 }))}>
                Next
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {modal && <FancyModal mode={modal.mode} row={modal.row} onClose={() => setModal(null)} />}
    </div>
  )
}

export default FancySettlement
