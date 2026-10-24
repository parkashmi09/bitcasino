'use client'

import { Fragment, useState } from 'react'

import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import PageHeader from '@/components/shared/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { errorMessage } from '@/lib/api/client'
import { BetTypeBadge, fixed2, MARKETS_FOR_FANCY, SETTLE_API, TabBar, useZipQuery, zipCall } from './shared'

/** `GET internalsettle/settled-markets` ki ek row */
type SettledMarket = {
  matchId: string
  eventId?: string
  matchTitle?: string
  teamOne?: string
  teamTwo?: string
  marketType?: string
  totalEntries?: number
  totalUsers?: number
  totalNetAmount?: number
}

/** `GET internalsettle/settled-bets` ki ek row */
type SettledBet = {
  ledgerId: number | string
  betId?: number | string
  userId?: number | string
  username?: string
  selectionName?: string
  betType?: string
  odds?: number | string
  stakeAmount?: number | string
  netamount?: number
  resultStatus?: string
}

const LIMIT = 200

const TABS = [
  { key: 'MATCH_ODDS', label: 'Match Odds' },
  { key: 'BOOKMAKER', label: 'Bookmaker' },
  { key: 'FANCY', label: 'Fancy' },
  { key: 'OTHERS', label: 'Others' }
]

// Server market_type waise hi bhejta hai jaise bet me tha — compare case-insensitive.
const FANCY_UPPER = MARKETS_FOR_FANCY.map(m => m.toUpperCase())
const isFancyMarketName = (mt: string) => FANCY_UPPER.includes(mt) || /\bLINE$/.test(mt)

function tabOf(m: SettledMarket) {
  const mt = String(m.marketType || '').toUpperCase()

  if (mt === 'MATCH_ODDS') return 'MATCH_ODDS'
  if (mt === 'BOOKMAKER') return 'BOOKMAKER'
  if (isFancyMarketName(mt)) return 'FANCY'

  return 'OTHERS'
}

const Net = ({ value }: { value?: number }) => {
  const v = Number(value || 0)

  return (
    <span className={`font-bold ${v >= 0 ? 'text-success' : 'text-destructive'}`}>
      {v >= 0 ? '+' : ''}
      {v.toFixed(2)}
    </span>
  )
}

const ResultBadge = ({ status }: { status?: string }) => {
  if (!status) return <span className='text-muted-foreground'>-</span>

  return <Badge variant={status === 'won' ? 'default' : status === 'loss' ? 'destructive' : 'secondary'}>{status.toUpperCase()}</Badge>
}

type Confirm = { type: 'market'; data: SettledMarket } | { type: 'bet'; data: SettledBet }

/**
 * Void Bets (After Settlement) — zip ka `pages/settlement/VoidBets.jsx`.
 * Pichhle X ghante me settle hue markets; poora market ya ek bet void karo.
 * "Create statement entry" OFF = silent void (statement se entries hat jaati hain).
 */
const VoidBets = () => {
  const [activeTab, setActiveTab] = useState('MATCH_ODDS')
  const [search, setSearch] = useState('')

  const [expanded, setExpanded] = useState<{ matchId: string; marketType?: string } | null>(null)
  const [bets, setBets] = useState<SettledBet[]>([])
  const [betsLoading, setBetsLoading] = useState(false)

  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [busy, setBusy] = useState(false)
  const [txnPassword, setTxnPassword] = useState('')
  const [writeStatement, setWriteStatement] = useState(true)

  // Search box me likhte waqt nahi — Search / Enter / Refresh pe hi list dobara (zip jaisa).
  const [appliedSearch, setAppliedSearch] = useState('')
  const list = useZipQuery<{ data?: SettledMarket[]; windowHours?: number }>(`${SETTLE_API}/settled-markets`, { limit: LIMIT, offset: 0, search: appliedSearch })
  const markets = Array.isArray(list.data?.data) ? list.data.data : []
  const windowHours = Number(list.data?.windowHours ?? 24)
  const loading = list.loading

  const fetchMarkets = () => {
    if (search !== appliedSearch) setAppliedSearch(search)
    else void list.refresh()
  }

  const fetchBets = async (matchId: string, marketType?: string) => {
    setBetsLoading(true)

    try {
      const res = await zipCall<{ data?: SettledBet[] }>('GET', `${SETTLE_API}/settled-bets`, { match_id: matchId, market_type: marketType })

      setBets(Array.isArray(res.data) ? res.data : [])
    } catch (e) {
      setBets([])
      toast.error(`Could not load settled bets: ${errorMessage(e)}`)
    } finally {
      setBetsLoading(false)
    }
  }

  const rows = markets.filter(m => tabOf(m) === activeTab)
  const tabCounts: Record<string, number> = {}

  for (const m of markets) tabCounts[tabOf(m)] = (tabCounts[tabOf(m)] ?? 0) + 1

  const isOpen = (m: SettledMarket) => expanded?.matchId === m.matchId && expanded?.marketType === m.marketType

  const toggle = (m: SettledMarket) => {
    if (isOpen(m)) {
      setExpanded(null)
      setBets([])
    } else {
      setExpanded({ matchId: m.matchId, marketType: m.marketType })
      void fetchBets(m.matchId, m.marketType)
    }
  }

  const askVoid = (c: Confirm) => {
    setTxnPassword('')
    setWriteStatement(true)
    setConfirm(c)
  }

  const doVoid = async () => {
    if (!confirm) return
    setBusy(true)

    try {
      if (confirm.type === 'market') {
        const res = await zipCall<{ affectedUsers?: number }>('POST', `${SETTLE_API}/void-market-after-settlement`, {
          match_id: confirm.data.matchId,
          market_type: confirm.data.marketType,
          write_statement: writeStatement,
          transactionPassword: txnPassword
        })

        toast.success(`Market voided — ${res.affectedUsers || 0} user(s) affected`)
      } else {
        await zipCall('POST', `${SETTLE_API}/void-bet-after-settlement`, {
          ledger_id: confirm.data.ledgerId,
          write_statement: writeStatement,
          transactionPassword: txnPassword
        })
        toast.success(`Bet voided for ${confirm.data.username || confirm.data.userId}`)
      }

      setConfirm(null)
      void list.refresh()
      if (expanded) void fetchBets(expanded.matchId, expanded.marketType)
    } catch (err) {
      // e.g. a wrong transaction password — keep the dialog open to retry
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader title={`Void Bets (After Settlement) — last ${windowHours}h`} />
      <Card className='shadow-none'>
        <CardContent className='grid gap-3'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <div className='flex w-full max-w-xl gap-2'>
              <Input
                placeholder='Search by match ID, market type, team name...'
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && fetchMarkets()}
              />
              <Button onClick={fetchMarkets}>Search</Button>
            </div>
            <Button size='sm' disabled={loading} onClick={fetchMarkets}>
              {loading ? 'Loading...' : 'Refresh'}
            </Button>
          </div>

          <TabBar
            tabs={TABS.map(t => ({ key: t.key, label: `${t.label} (${tabCounts[t.key] || 0})` }))}
            active={activeTab}
            onChange={key => {
              setActiveTab(key)
              setExpanded(null)
              setBets([])
            }}
          />

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Match Title</TableHead>
                <TableHead>Market Type</TableHead>
                <TableHead className='text-right'>Entries</TableHead>
                <TableHead className='text-right'>Users</TableHead>
                <TableHead className='text-right'>Net Amount</TableHead>
                <TableHead className='min-w-[220px] text-center'>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className='text-center'>
                    Loading...
                  </TableCell>
                </TableRow>
              ) : list.error && !list.data ? (
                <TableRow>
                  <TableCell colSpan={6} className='text-destructive text-center'>
                    Could not load settled markets: {errorMessage(list.error)}
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className='text-center'>
                    No markets settled in the last {windowHours} hours
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((m, i) => (
                  <Fragment key={`${m.matchId}-${m.marketType}-${i}`}>
                    <TableRow>
                      <TableCell>
                        <div className='font-bold'>{m.matchTitle || (m.teamOne && m.teamTwo ? `${m.teamOne} vs ${m.teamTwo}` : m.matchId)}</div>
                        <small className='text-muted-foreground'>{m.matchId}</small>
                      </TableCell>
                      <TableCell>{m.marketType || '-'}</TableCell>
                      <TableCell className='text-right'>{m.totalEntries}</TableCell>
                      <TableCell className='text-right'>{m.totalUsers}</TableCell>
                      <TableCell className='text-right'>
                        <Net value={m.totalNetAmount} />
                      </TableCell>
                      <TableCell className='text-center'>
                        <div className='flex justify-center gap-1'>
                          <Button size='sm' onClick={() => toggle(m)}>
                            {isOpen(m) ? 'Hide Bets' : 'View Bets'}
                          </Button>
                          <Button size='sm' variant='destructive' onClick={() => askVoid({ type: 'market', data: m })}>
                            Void Market
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {isOpen(m) && (
                      <TableRow>
                        <TableCell colSpan={6} className='bg-muted/40 p-3'>
                          <div className='mb-2 flex items-center justify-between'>
                            <strong className='text-sm'>Individual Bets — {m.marketType}</strong>
                            <small className='text-muted-foreground'>
                              {bets.length} bet{bets.length !== 1 ? 's' : ''}
                            </small>
                          </div>
                          {betsLoading ? (
                            <div className='text-muted-foreground py-3 text-center text-sm'>Loading bets...</div>
                          ) : bets.length === 0 ? (
                            <div className='text-muted-foreground py-3 text-center text-sm'>No bets found for this market</div>
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
                                  <TableHead className='text-right'>Net Amount</TableHead>
                                  <TableHead className='text-center'>Result</TableHead>
                                  <TableHead className='text-center'>Action</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {bets.map(bet => (
                                  <TableRow key={bet.ledgerId}>
                                    <TableCell>#{bet.betId}</TableCell>
                                    <TableCell>{bet.username}</TableCell>
                                    <TableCell>{bet.selectionName || '-'}</TableCell>
                                    <TableCell className='text-center'>
                                      <BetTypeBadge type={bet.betType} />
                                    </TableCell>
                                    <TableCell className='text-right'>{bet.odds ?? '-'}</TableCell>
                                    <TableCell className='text-right'>{fixed2(bet.stakeAmount)}</TableCell>
                                    <TableCell className='text-right'>
                                      <Net value={bet.netamount} />
                                    </TableCell>
                                    <TableCell className='text-center'>
                                      <ResultBadge status={bet.resultStatus} />
                                    </TableCell>
                                    <TableCell className='text-center'>
                                      <Button size='sm' variant='outline' onClick={() => askVoid({ type: 'bet', data: bet })}>
                                        Void Bet
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          )}
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

      <Dialog open={Boolean(confirm)} onOpenChange={open => !open && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm?.type === 'market' ? 'Void Entire Market' : 'Void Single Bet'}</DialogTitle>
          </DialogHeader>
          {confirm && (
            <div className='bg-warning-soft grid gap-2 rounded-md p-3 text-sm'>
              {confirm.type === 'market' ? (
                <>
                  <p>
                    Void <strong>all bets</strong> in market <strong>{confirm.data.marketType}</strong> for match{' '}
                    <strong>{confirm.data.matchTitle || confirm.data.matchId}</strong>?
                  </p>
                  <p className='text-muted-foreground'>
                    This will reverse settled amounts for <strong>{confirm.data.totalEntries}</strong> entries across <strong>{confirm.data.totalUsers}</strong> users. This
                    action cannot be undone.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    Void bet <strong>#{confirm.data.betId}</strong> for user <strong>{confirm.data.username}</strong>?
                  </p>
                  <p className='text-muted-foreground'>
                    Net amount to reverse: <Net value={confirm.data.netamount} />. This action cannot be undone.
                  </p>
                </>
              )}
            </div>
          )}
          <label className='flex items-start gap-2 text-sm'>
            <Checkbox checked={writeStatement} onCheckedChange={v => setWriteStatement(Boolean(v))} />
            <span>
              Create statement entry — a <strong>-void</strong> line in the user&apos;s account statement
            </span>
          </label>
          {!writeStatement && (
            <div className='bg-destructive/10 text-destructive rounded-md p-2 text-sm'>
              <strong>Silent void.</strong> The settlement {confirm?.type === 'market' ? 'and commission entries' : 'and commission entry'} will be{' '}
              <strong>deleted</strong> from the account statement — nothing will show there. The money is refunded either way.
            </div>
          )}
          <div className='grid gap-2'>
            <Label htmlFor='void-txn'>Transaction Password</Label>
            <Input id='void-txn' type='password' autoComplete='off' value={txnPassword} onChange={e => setTxnPassword(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button variant='destructive' disabled={busy || !txnPassword} onClick={doVoid}>
              {busy && <Loader2Icon className='animate-spin' />}
              {busy ? 'Processing...' : 'Confirm Void'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default VoidBets
