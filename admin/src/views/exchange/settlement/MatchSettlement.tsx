'use client'

import { Fragment, useState } from 'react'

import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import PageHeader from '@/components/shared/PageHeader'
import TxnCodeInput from '@/components/shared/TxnCodeInput'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { errorMessage } from '@/lib/api/client'
import { OpenBetsPanel, SETTLE_API, TabBar, useZipQuery, zipCall, type OpenBet } from './shared'

/** `GET internalsettle/momatches` ki ek row */
type MoMatch = {
  matchId: string
  eventId: string
  matchTitle?: string
  teamOne?: string
  teamTwo?: string
  marketType?: string
  gameType: 'MO' | 'BM'
  totalBets?: number
  counts?: number
  runners?: string[]
}

const LIMIT = 100

const titleOf = (m: MoMatch) => m.matchTitle ?? `${m.teamOne} vs ${m.teamTwo}`
const keyOf = (m: MoMatch) => `${m.matchId}-${m.marketType}-${m.gameType}`

/**
 * Declare Result / Void Match — zip ka `components/SettlementModal.jsx`.
 * Declare: runner chuno (2-way me "VS" ke saath), Void: saari bets refund.
 */
const SettlementModal = ({ mode, match, onClose }: { mode: 'declare' | 'void'; match: MoMatch | null; onClose: (done: boolean) => void }) => {
  const [selected, setSelected] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [code, setCode] = useState('')

  if (!match) return null

  const counts = match.counts ?? 2
  const totalBets = match.totalBets ?? 0
  const isThreeWay = counts >= 3 || totalBets >= 3
  const teamOne = match.teamOne ?? 'Team 1'
  const teamTwo = match.teamTwo ?? 'Team 2'

  // Purani bets me runners nahi hote — tab 3-way fallback (draw ka naam 'The Draw').
  const runners = match.runners?.length ? match.runners : isThreeWay ? [teamOne, teamTwo, 'The Draw'] : [teamOne, teamTwo]

  const submit = async () => {
    setSubmitting(true)

    try {
      if (mode === 'void') {
        await zipCall('POST', `${SETTLE_API}/void`, {
          eventid: match.eventId,
          match_id: match.matchId,
          market_type: match.marketType,
          gametype: match.gameType || 'FAN',
          transactionPassword: code
        })
      } else {
        await zipCall('POST', `${SETTLE_API}/declareresult`, {
          eventid: match.eventId,
          match_id: match.matchId,
          match_title: titleOf(match),
          game_type: match.gameType,
          market_type: match.marketType,
          winnerName: runners[selected ?? -1] ?? '',
          transactionPassword: code
        })
      }

      toast.success(mode === 'void' ? `${titleOf(match)} voided — stakes refunded` : `Result declared: ${runners[selected ?? -1] ?? ''}`)
      onClose(true)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSubmitting(false)
    }
  }

  const outcome = (label: string, idx: number) => (
    <Button key={idx} type='button' variant={selected === idx ? 'default' : 'outline'} className='m-1 min-w-[110px] font-bold' onClick={() => setSelected(idx)}>
      {label}
    </Button>
  )

  const canSubmit = Boolean(code) && (mode === 'void' || selected != null)

  return (
    <Dialog open onOpenChange={open => !open && onClose(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'void' ? 'Void Match' : 'Declare Result'}</DialogTitle>
        </DialogHeader>
        <div className='text-center font-bold'>{titleOf(match)}</div>

        {mode === 'declare' && (
          <>
            <div className='flex flex-wrap items-center justify-center'>
              {isThreeWay
                ? runners.map((r, i) => outcome(r, i))
                : runners.map((r, i) => (
                    <span key={i} className='inline-flex items-center'>
                      {i > 0 && <span className='text-muted-foreground mx-2'>VS</span>}
                      {outcome(r, i)}
                    </span>
                  ))}
            </div>
            <div className='text-center text-sm'>
              {selected != null ? (
                <>
                  Result: <strong>{runners[selected]}</strong>
                </>
              ) : (
                <span className='text-muted-foreground'>{runners.length > 2 ? 'Select a runner' : 'Select winner'}</span>
              )}
            </div>
          </>
        )}

        {mode === 'void' && (
          <div className='bg-warning-soft rounded-md p-3 text-sm'>
            Do you really want to cancel or refund the bets? All stakes will be refunded to the users. This action cannot be undone.
          </div>
        )}

        <TxnCodeInput id='ms-tp' value={code} onChange={setCode} />

        <DialogFooter>
          <Button variant='outline' onClick={() => onClose(false)}>
            Cancel
          </Button>
          <Button variant={mode === 'void' ? 'destructive' : 'default'} disabled={!canSubmit || submitting} onClick={submit}>
            {submitting && <Loader2Icon className='animate-spin' />}
            {submitting ? 'Submitting...' : mode === 'void' ? 'Confirm Void' : 'Submit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Match Settlement — zip ka `pages/settlement/MatchSettlement.jsx`.
 * Match Odds / Bookmaker tabs, har 2 second me refresh, Declare / Void / Per Bet.
 */
const MatchSettlement = () => {
  const [activeTab, setActiveTab] = useState<'MO' | 'BM'>('MO')
  const [modal, setModal] = useState<{ mode: 'declare' | 'void'; match: MoMatch } | null>(null)

  const [expanded, setExpanded] = useState<string | null>(null)
  const [openBets, setOpenBets] = useState<OpenBet[]>([])
  const [betsLoading, setBetsLoading] = useState(false)

  // Har 2 second me list dobara (zip jaisa).
  const list = useZipQuery<{ data?: MoMatch[] }>(`${SETTLE_API}/momatches`, { limit: LIMIT, offset: 0 }, 2000)
  const matches = Array.isArray(list.data?.data) ? list.data.data : []
  const loading = list.loading

  const rows = matches.filter(m => m.gameType === activeTab)

  const loadBets = async (m: MoMatch) => {
    setBetsLoading(true)

    try {
      const res = await zipCall<{ data?: OpenBet[] }>('GET', `${SETTLE_API}/open-bets`, { match_id: m.matchId, market_type: m.marketType, game_type: m.gameType })

      setOpenBets(res.data ?? [])
    } catch (e) {
      setOpenBets([])
      toast.error(`Could not load open bets: ${errorMessage(e)}`)
    } finally {
      setBetsLoading(false)
    }
  }

  const toggleBets = (m: MoMatch) => {
    if (expanded === keyOf(m)) {
      setExpanded(null)
      setOpenBets([])

      return
    }

    setExpanded(keyOf(m))
    void loadBets(m)
  }

  return (
    <div>
      <PageHeader title='Match Settlement' />
      <Card className='shadow-none'>
        <CardContent className='grid gap-3'>
          <div className='flex items-center justify-between gap-2'>
            <TabBar
              tabs={[
                { key: 'MO', label: 'Match Odds' },
                { key: 'BM', label: 'Bookmaker' }
              ]}
              active={activeTab}
              onChange={key => {
                setActiveTab(key as 'MO' | 'BM')
                setExpanded(null)
              }}
            />
            <Button size='sm' disabled={loading} onClick={list.refresh}>
              {loading ? 'Loading...' : 'Refresh'}
            </Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Match Title</TableHead>
                <TableHead>Market Type</TableHead>
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
                    Could not load matches: {errorMessage(list.error)}
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className='text-center'>
                    No matches found
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((m, i) => (
                  <Fragment key={`${m.matchId}-${m.eventId}-${m.gameType}-${i}`}>
                    <TableRow>
                      <TableCell className='font-bold'>{titleOf(m)}</TableCell>
                      <TableCell>{m.marketType || '-'}</TableCell>
                      <TableCell className='text-right'>{m.totalBets ?? 0}</TableCell>
                      <TableCell className='text-center'>
                        <div className='flex justify-center gap-1'>
                          <Button size='sm' onClick={() => setModal({ mode: 'declare', match: m })}>
                            Declare
                          </Button>
                          <Button size='sm' variant='secondary' onClick={() => setModal({ mode: 'void', match: m })}>
                            Void
                          </Button>
                          <Button size='sm' variant='outline' onClick={() => toggleBets(m)}>
                            {expanded === keyOf(m) ? 'Hide' : 'Per Bet'}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {expanded === keyOf(m) && (
                      <TableRow>
                        <TableCell colSpan={4} className='p-0'>
                          <OpenBetsPanel
                            title={m.marketType ?? ''}
                            bets={openBets}
                            loading={betsLoading}
                            onVoided={() => {
                              void list.refresh()
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
        </CardContent>
      </Card>

      {modal && (
        <SettlementModal
          mode={modal.mode}
          match={modal.match}
          onClose={done => {
            setModal(null)
            if (done) void list.refresh()
          }}
        />
      )}
    </div>
  )
}

export default MatchSettlement
