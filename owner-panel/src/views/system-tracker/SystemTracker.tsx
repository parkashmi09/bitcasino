'use client'

import { Fragment, useRef, useState, type ReactNode } from 'react'

import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import ConfirmDialog from '@/components/shared/ConfirmDialog'
import ErrorState from '@/components/shared/ErrorState'
import PageHeader from '@/components/shared/PageHeader'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { toastError } from '@/lib/api/feedback'
import { cn } from '@/lib/utils'

/**
 * System Tracker — zip `pages/system-tracker/SystemTracker.jsx`. Sirf OWNER PANEL me hai
 * (site admin me nahi): data `/api/owner/system-tracker/*` se, jo site ke backend ko
 * `x-owner-key` ke saath poochta hai.
 *
 * Teen tab:
 *   Alerts        — har account ke paise ki jaanch (credits / point_ledger / bets)
 *   Account Trace — ek account: rule-by-rule + "ye balance kahan se aaya"
 *   Watchdog      — jo market settle nahi ho rahe, har ek ke saath kya karna hai
 *
 * Yahan se PAISA NAHI HILTA. Watchdog ka button site admin ki Settlement screen (naye tab me)
 * kholta hai — void/settle wahin transaction password ke saath hota hai.
 */

const TRACKER = '/api/owner/system-tracker'

/** Zip ka "ago" — 5m ago, 3h ago, 2d ago. */
const ago = (ts?: string | null) => {
  if (!ts) return '—'
  const mins = Math.round((Date.now() - new Date(ts).getTime()) / 60000)

  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.round(mins / 60)

  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
}

/** Paisa — en-IN, 2 decimal. */
const money = (v: unknown) =>
  Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type Issue = { key: string; label: string; detail: string; severity: string; since: string }
type AlertUser = { user_id: string; username: string | null; role: string | null; issues: Issue[] }

type AlertsData = {
  count: number
  totalIssues: number
  actionable: number
  actionableUsers: number
  informational: number
  users: AlertUser[]
  lastScan: string | null
}

type Rule = {
  label: string
  expected?: number
  actual?: number
  diff?: number
  pass: boolean
  info?: boolean
  note?: string
  subs?: { label: string; note?: string; actual?: number }[]
}

type Category = { key: string; label: string; pass: boolean; rules: Rule[] }

type Report = {
  snapshot: {
    total_balance: number
    available_balance: number
    locked_exposure: number
    actual_pl: number | null
    total_win?: number
    total_loss?: number
    counters_lag?: boolean
    profit_loss?: number
    net_win?: number
    net_loss?: number
  }
  allPass: boolean
  categories: Category[]
}

type ProvEvent = {
  id: number | string
  at: string
  amount: number
  counterparty?: string
  type?: string
  bet_id?: number
  market_type?: string
  remark?: string
}

type Bucket = {
  key: string
  label: string
  amount: number
  count: number
  events?: ProvEvent[]
  note?: string
  severity?: string | null
  truncated?: boolean
}

type Provenance = {
  account: { username: string }
  upline: { kind: string; id: string; username: string | null; broken?: boolean }[]
  buckets: Bucket[]
  reconciliation: {
    opening: number
    transactions: number
    settlement: number
    derived: number
    stored: number
    residual: number
    pass: boolean
    note: string
    ledger?: { complete: boolean; note: string; recordedPL: number; observedMovement: number; undescribed: number }
  }
}

type Finding = {
  id: number
  kind: string
  ref_key: string
  label: string
  title: string | null
  detail: string | null
  severity: string
  market_type: string | null
  event_id: string | null
  bets_count: number | null
  stake_total: string | number | null
  stale_hours: string | number | null
  suggested_action: string | null
  action_endpoint: string | null
  acknowledged_by: string | null
  acknowledged_at: string | null
}

type WatchdogData = {
  count: number
  critical: number
  stakeAtRisk: number
  findings: Finding[]
  thresholds: { STALE_HOURS?: number }
  lastScan: string | null
}

type Suggestion = { user_id: string; username: string; role: string; kind: string }

/** Har watchdog finding kaunsi Settlement screen se theek hota hai. */
const ACTION_PAGE: Record<string, { to: string; label: string }> = {
  resultDeclaredNotSettled: { to: '/exchange/settlement', label: 'Open Match Settlement' },
  staleOpenMarket: { to: '/exchange/settlement', label: 'Open Match Settlement' },
  staleFancy: { to: '/exchange/settlement?tab=fancy', label: 'Open Fancy Settlement' },
  resultNeverDeclared: { to: '/exchange/settlement', label: 'Open Match Settlement' }
}

/** critical = laal, high = peela, info/review = grey. */
const SevBadge = ({ severity, children }: { severity: string; children?: ReactNode }) => (
  <Badge
    variant={severity === 'critical' ? 'destructive' : 'secondary'}
    className={cn(severity === 'high' && 'bg-warning/15 text-warning')}
  >
    {children ?? severity}
  </Badge>
)

const StatCard = ({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) => (
  <Card className='py-4'>
    <CardContent>
      <p className='text-muted-foreground mb-1 text-xs'>{label}</p>
      <p className={cn('text-xl font-semibold', tone)}>{value}</p>
    </CardContent>
  </Card>
)

const amountTone = (v: number) => (Number(v) < 0 ? 'text-destructive' : 'text-success')

/* ------------------------------------------------------------------ Alerts tab */
const AlertsTab = ({
  data,
  onScan,
  scanning,
  onPick
}: {
  data?: AlertsData
  onScan: () => void
  scanning: boolean
  onPick: (who: string) => void
}) => {
  if (!data) return null
  const users = data.users || []

  return (
    <div className='space-y-4'>
      <div className='grid grid-cols-2 gap-3 md:grid-cols-5'>
        <StatCard
          label='Accounts flagged'
          value={data.actionableUsers ?? data.count ?? 0}
          tone={data.actionable ? 'text-destructive' : 'text-success'}
        />
        <StatCard
          label='Actionable findings'
          value={data.actionable ?? 0}
          tone={data.actionable ? 'text-destructive' : 'text-success'}
        />
        <StatCard label='Informational' value={data.informational ?? 0} />
        <StatCard label='Last scan' value={ago(data.lastScan)} />
        <Card className='justify-center py-4'>
          <CardContent>
            <Button size='sm' className='w-full' onClick={onScan} disabled={scanning}>
              {scanning ? 'Scanning…' : 'Re-scan now'}
            </Button>
          </CardContent>
        </Card>
      </div>

      {users.length === 0 ? (
        <Alert>
          <AlertDescription className='text-success'>
            No integrity findings. Every account&apos;s wallet, points and hierarchy reconcile.
          </AlertDescription>
        </Alert>
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='w-14'>#</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Findings</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u, i) => (
                <TableRow key={u.user_id}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell>
                    <button
                      type='button'
                      className='text-primary hover:underline'
                      onClick={() => onPick(u.username || u.user_id)}
                    >
                      {u.username || u.user_id}
                    </button>
                    <div className='text-muted-foreground text-xs'>{u.user_id}</div>
                  </TableCell>
                  <TableCell>{u.role || '—'}</TableCell>
                  <TableCell className='space-y-1 whitespace-normal'>
                    {u.issues.map(is => (
                      <div key={is.key}>
                        <SevBadge severity={is.severity}>{is.severity === 'info' ? 'info only' : is.severity}</SevBadge>{' '}
                        <strong>{is.label}</strong>
                        <div className='text-muted-foreground text-xs'>
                          {is.detail} · since {ago(is.since)}
                        </div>
                      </div>
                    ))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------- Provenance panel */
const ProvenancePanel = ({ prov }: { prov: Provenance | null }) => {
  const [open, setOpen] = useState<Record<string, boolean>>({})

  if (!prov) return null
  const r = prov.reconciliation

  return (
    <Card>
      <CardContent className='space-y-4'>
        <div>
          <h5 className='font-semibold'>Where this balance came from</h5>
          <p className='text-muted-foreground text-xs'>
            Every rupee traced to the event that moved it, and to the account on the other side.
          </p>
        </div>

        {prov.upline?.length > 0 && (
          <div className='text-sm'>
            <span className='text-muted-foreground mr-2 text-xs'>Chain to owner:</span>
            <strong>{prov.account.username}</strong>
            {prov.upline.map(u => (
              <span key={`${u.kind}-${u.id}`}>
                <span className='text-muted-foreground mx-1'>←</span>
                <span className={cn(u.broken && 'text-destructive')}>
                  {u.username || u.id}
                  {u.broken ? ' (broken link)' : ''}
                </span>
              </span>
            ))}
          </div>
        )}

        <div className='overflow-x-auto rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead className='text-right'>Amount</TableHead>
                <TableHead className='w-24'>Events</TableHead>
                <TableHead className='w-10' />
              </TableRow>
            </TableHeader>
            <TableBody>
              {prov.buckets
                .filter(b => b.amount !== 0 || b.count > 0)
                .map(b => (
                  <Fragment key={b.key}>
                    <TableRow className={cn(b.severity === 'attention' && 'bg-destructive/10')}>
                      <TableCell className='whitespace-normal'>
                        {b.label}
                        {b.severity === 'attention' && (
                          <Badge variant='destructive' className='ml-2'>
                            manual override
                          </Badge>
                        )}
                        {b.note && <div className='text-muted-foreground text-xs'>{b.note}</div>}
                      </TableCell>
                      <TableCell className={cn('text-right tabular-nums', amountTone(b.amount))}>
                        {money(b.amount)}
                      </TableCell>
                      <TableCell>
                        {b.count || 0}
                        {b.truncated ? '+' : ''}
                      </TableCell>
                      <TableCell>
                        {b.count > 0 && Boolean(b.events?.length) && (
                          <button
                            type='button'
                            className='text-primary'
                            onClick={() => setOpen(o => ({ ...o, [b.key]: !o[b.key] }))}
                          >
                            {open[b.key] ? '−' : '+'}
                          </button>
                        )}
                      </TableCell>
                    </TableRow>
                    {open[b.key] &&
                      (b.events || []).map(e => (
                        <TableRow key={`${b.key}-${e.id}`} className='bg-muted/40'>
                          <TableCell className='pl-7 text-xs whitespace-normal'>
                            {new Date(e.at).toLocaleString('en-IN')}
                            {e.counterparty && (
                              <>
                                {' '}
                                · <strong>{e.counterparty}</strong>
                              </>
                            )}
                            {e.type && <> · {e.type}</>}
                            {e.bet_id && <> · bet #{e.bet_id}</>}
                            {e.market_type && <> · {e.market_type}</>}
                            {e.remark && <div className='text-muted-foreground'>{e.remark}</div>}
                          </TableCell>
                          <TableCell className={cn('text-right text-xs tabular-nums', amountTone(e.amount))}>
                            {money(e.amount)}
                          </TableCell>
                          <TableCell colSpan={2} />
                        </TableRow>
                      ))}
                  </Fragment>
                ))}
            </TableBody>
          </Table>
        </div>

        <Alert variant={r.pass ? 'default' : 'destructive'}>
          <AlertTitle className={cn(r.pass && 'text-success')}>
            {r.pass ? 'Balance fully accounted for' : 'Balance does not reconcile'}
          </AlertTitle>
          <AlertDescription>
            <div className='text-xs'>{r.note}</div>
            <div className='mt-1 text-xs'>
              opening {money(r.opening)} + transfers {money(r.transactions)} + game activity {money(r.settlement)} ={' '}
              <strong>{money(r.derived)}</strong> vs stored <strong>{money(r.stored)}</strong>
              {!r.pass && <span className='text-destructive'> · residual {money(r.residual)}</span>}
            </div>
          </AlertDescription>
        </Alert>

        {/* Alarm nahi — sirf ledger ki detail poori nahi. */}
        {r.ledger && !r.ledger.complete && (
          <Alert>
            <AlertTitle className='text-sm'>Ledger detail incomplete — not a money problem</AlertTitle>
            <AlertDescription className='text-xs'>
              <div>{r.ledger.note}</div>
              <div>
                ledger P/L rows {money(r.ledger.recordedPL)} · actual movement {money(r.ledger.observedMovement)} · not
                described by P/L rows: {money(r.ledger.undescribed)}
              </div>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------- Trace tab */
const TraceTab = ({
  query,
  setQuery,
  report,
  prov,
  onSearch,
  suggestions,
  onPick,
  loading
}: {
  query: string
  setQuery: (v: string) => void
  report: Report | null
  prov: Provenance | null
  onSearch: (v: string) => void
  suggestions: Suggestion[]
  onPick: (who: string) => void
  loading: boolean
}) => {
  const [queryError, setQueryError] = useState<string | null>(null)

  const trace = () => {
    const who = query.trim()

    if (!who) return setQueryError('Type a username or user ID to trace')
    if (loading) return
    onPick(who)
  }

  return (
  <div className='space-y-4'>
    <div className='relative max-w-xl'>
      <div className='flex gap-2'>
        <Input
          placeholder='Search username or ID…'
          value={query}
          aria-invalid={!!queryError}
          onChange={e => {
            setQuery(e.target.value)
            setQueryError(null)
            onSearch(e.target.value)
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') trace()
          }}
        />
        <Button onClick={trace} disabled={loading}>
          {loading && <Loader2Icon className='animate-spin' />} Trace
        </Button>
      </div>
      {queryError && (
        <p className='text-destructive mt-1 text-xs' role='alert' data-error='trace-query'>
          {queryError}
        </p>
      )}
      {suggestions.length > 0 && (
        <div className='bg-popover absolute z-20 mt-1 w-full overflow-hidden rounded-md border shadow-md'>
          {suggestions.map(s => (
            <button
              key={`${s.kind}-${s.user_id}`}
              type='button'
              className='hover:bg-muted block w-full px-3 py-1.5 text-left text-sm'
              onClick={() => onPick(s.username || s.user_id)}
            >
              <strong>{s.username}</strong>
              <span className='text-muted-foreground ml-2 text-xs'>
                {s.role} · {s.kind}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>

    {loading && <p className='text-muted-foreground text-sm'>Loading…</p>}

    {report?.snapshot && (
      <>
        <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
          <StatCard label='Total balance' value={money(report.snapshot.total_balance)} />
          <StatCard label='Available' value={money(report.snapshot.available_balance)} />
          <StatCard label='Locked in bets' value={money(report.snapshot.locked_exposure)} />
          <StatCard
            label='Verdict'
            value={report.allPass ? 'All checks pass' : 'Issues found'}
            tone={report.allPass ? 'text-success' : 'text-destructive'}
          />
        </div>

        {/* Ledger se nikla P/L — yahi bharose wala. Stored counters sirf alag hon to dikhte hain. */}
        {report.snapshot.actual_pl != null && (
          <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
            <StatCard
              label='Actual P/L (ledger)'
              value={money(report.snapshot.actual_pl)}
              tone={amountTone(report.snapshot.actual_pl)}
            />
            <StatCard label='Total win (ledger)' value={money(report.snapshot.total_win)} />
            <StatCard label='Total loss (ledger)' value={money(report.snapshot.total_loss)} />
            <StatCard
              label='Stored counters'
              value={
                report.snapshot.counters_lag ? (
                  <span className='text-warning text-base'>
                    Lagging
                    <span className='text-muted-foreground block text-xs font-normal'>
                      reads {money(report.snapshot.profit_loss)} · win {money(report.snapshot.net_win)} · loss{' '}
                      {money(report.snapshot.net_loss)}
                    </span>
                  </span>
                ) : (
                  <span className='text-success text-base'>Agree with ledger</span>
                )
              }
            />
          </div>
        )}

        {report.categories.map(c => (
          <Card key={c.key} className='py-3'>
            <CardContent className='space-y-2'>
              <h6 className='flex items-center gap-2 font-semibold'>
                <Badge variant={c.pass ? 'default' : 'destructive'} className={cn(c.pass && 'bg-success')}>
                  {c.pass ? 'OK' : 'FAIL'}
                </Badge>
                {c.label}
              </h6>
              <Table>
                <TableBody>
                  {c.rules.map((ru, i) => (
                    <Fragment key={`${c.key}-${i}`}>
                      <TableRow>
                        <TableCell className='w-20'>
                          <Badge
                            variant={ru.info ? 'secondary' : ru.pass ? 'default' : 'destructive'}
                            className={cn(!ru.info && ru.pass && 'bg-success')}
                          >
                            {ru.info ? 'info' : ru.pass ? 'pass' : 'fail'}
                          </Badge>
                        </TableCell>
                        <TableCell className='whitespace-normal'>
                          {ru.label}
                          {ru.note && <div className='text-muted-foreground text-xs'>{ru.note}</div>}
                        </TableCell>
                        <TableCell className='w-64 text-right text-xs'>
                          {!ru.info && (
                            <>
                              expected {money(ru.expected)} · actual {money(ru.actual)}
                              {Math.abs(Number(ru.diff)) > 0.01 && (
                                <span className='text-destructive'> · diff {money(ru.diff)}</span>
                              )}
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                      {(ru.subs || []).map((sub, j) => (
                        <TableRow key={`${c.key}-${i}-${j}`} className='bg-muted/40'>
                          <TableCell />
                          <TableCell className='pl-6 text-xs whitespace-normal'>
                            {sub.label}
                            {sub.note && <span className='text-muted-foreground ml-2'>{sub.note}</span>}
                          </TableCell>
                          <TableCell className='text-right text-xs'>
                            {sub.actual != null ? money(sub.actual) : ''}
                          </TableCell>
                        </TableRow>
                      ))}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))}

        <ProvenancePanel prov={prov} />
      </>
    )}
  </div>
  )
}

/* ---------------------------------------------------------------- Watchdog tab */
const WatchdogTab = ({
  data,
  onScan,
  scanning,
  onAck,
  adminUrl
}: {
  data?: WatchdogData
  onScan: () => void
  scanning: boolean
  onAck: (row: Finding) => Promise<void>
  adminUrl: string
}) => {
  if (!data) return null
  const f = data.findings || []
  const th = data.thresholds || {}

  return (
    <div className='space-y-4'>
      <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
        <StatCard
          label='Open findings'
          value={data.count ?? 0}
          tone={data.count ? 'text-destructive' : 'text-success'}
        />
        <StatCard label='Critical' value={data.critical ?? 0} tone={data.critical ? 'text-destructive' : ''} />
        <StatCard label='Stake at risk' value={money(data.stakeAtRisk)} />
        <Card className='py-4'>
          <CardContent>
            <Button size='sm' className='w-full' onClick={onScan} disabled={scanning}>
              {scanning ? 'Sweeping…' : 'Sweep now'}
            </Button>
            <div className='text-muted-foreground mt-1 text-xs'>
              stale after {th.STALE_HOURS}h · last {ago(data.lastScan)}
            </div>
          </CardContent>
        </Card>
      </div>

      {f.length === 0 ? (
        <Alert>
          <AlertDescription className='text-success'>
            Nothing stuck. Every market with open bets is within the {th.STALE_HOURS}-hour window, settlement jobs are
            moving and the result feed is live.
          </AlertDescription>
        </Alert>
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Severity</TableHead>
                <TableHead>What is stuck</TableHead>
                <TableHead className='text-right'>Bets</TableHead>
                <TableHead className='text-right'>Stake</TableHead>
                <TableHead className='text-right'>Age</TableHead>
                <TableHead>What to do</TableHead>
                <TableHead className='w-48' />
              </TableRow>
            </TableHeader>
            <TableBody>
              {f.map(row => {
                const act = ACTION_PAGE[row.kind]

                return (
                  <TableRow key={row.id} className={cn(row.acknowledged_by && 'opacity-75')}>
                    <TableCell>
                      <SevBadge severity={row.severity} />
                    </TableCell>
                    <TableCell className='whitespace-normal'>
                      <strong>{row.title || row.ref_key}</strong>
                      <div className='text-muted-foreground text-xs'>{row.detail}</div>
                      <div className='text-muted-foreground text-xs'>
                        {row.label}
                        {row.market_type ? ` · ${row.market_type}` : ''}
                        {row.event_id ? ` · event ${row.event_id}` : ''}
                      </div>
                    </TableCell>
                    <TableCell className='text-right'>{row.bets_count ?? '—'}</TableCell>
                    <TableCell className='text-right'>{money(row.stake_total)}</TableCell>
                    <TableCell className='text-right'>
                      {row.stale_hours != null ? `${row.stale_hours}h` : '—'}
                    </TableCell>
                    <TableCell className='text-xs whitespace-normal'>
                      {row.suggested_action}
                      {row.action_endpoint && <div className='text-muted-foreground'>{row.action_endpoint}</div>}
                    </TableCell>
                    <TableCell className='space-y-1 text-right'>
                      {act && adminUrl && (
                        <Button
                          size='sm'
                          className='w-full'
                          render={
                            <a
                              href={`${adminUrl.replace(/\/$/, '')}${act.to}`}
                              target='_blank'
                              rel='noopener noreferrer'
                            />
                          }
                          nativeButton={false}
                        >
                          {act.label}
                        </Button>
                      )}
                      {row.acknowledged_by ? (
                        <div className='text-muted-foreground text-xs'>
                          ack by {row.acknowledged_by} {ago(row.acknowledged_at)}
                        </div>
                      ) : (
                        <ConfirmDialog
                          trigger={
                            <Button size='sm' variant='outline' className='w-full'>
                              I am handling this
                            </Button>
                          }
                          title='Mark as being handled?'
                          description={`"${row.title || row.ref_key}" stays on the board but stops being counted as unattended. This does not settle or void anything.`}
                          confirmLabel='Yes, I am handling it'
                          onConfirm={() => onAck(row)}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------------ page */
const SystemTracker = ({ adminUrl }: { adminUrl: string }) => {
  const [tab, setTab] = useState('alerts')
  const alerts = useApi<AlertsData>(`${TRACKER}/alerts`)
  const watchdog = useApi<WatchdogData>(`${TRACKER}/watchdog`)
  const [scanning, setScanning] = useState(false)
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [report, setReport] = useState<Report | null>(null)
  const [prov, setProv] = useState<Provenance | null>(null)
  const [traceLoading, setTraceLoading] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const doScan = async () => {
    setScanning(true)

    try {
      await api.post(`${TRACKER}/scan`)
      const r = await alerts.refetch()

      if (r.error) toastError(r.error, 'Scanned, but the alerts did not reload')
      else toast.success('Scan finished', { description: `${r.data?.actionable ?? 0} actionable finding(s) on ${r.data?.actionableUsers ?? 0} account(s)` })
    } catch (err) {
      toastError(err, 'Scan failed')
    } finally {
      setScanning(false)
    }
  }

  const doWatchdogScan = async () => {
    setScanning(true)

    try {
      await api.post(`${TRACKER}/watchdog/scan`)
      const r = await watchdog.refetch()

      if (r.error) toastError(r.error, 'Swept, but the watchdog did not reload')
      else toast.success('Sweep finished', { description: `${r.data?.count ?? 0} open finding(s)` })
    } catch (err) {
      toastError(err, 'Sweep failed')
    } finally {
      setScanning(false)
    }
  }

  // Debounce — har akshar pe request nahi.
  const onSearch = (v: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current)

    if (!v || v.trim().length < 2) {
      setSuggestions([])

      return
    }

    searchTimer.current = setTimeout(async () => {
      try {
        const res = await api.get<{ results: Suggestion[] }>(`${TRACKER}/search`, { q: v.trim() })

        setSuggestions(res?.results || [])
      } catch {
        setSuggestions([])
      }
    }, 250)
  }

  const pickAccount = async (who: string) => {
    setSuggestions([])
    setQuery(who)
    setTab('trace')
    setTraceLoading(true)
    setReport(null)
    setProv(null)

    try {
      const key = encodeURIComponent(who)

      const [rep, pr] = await Promise.allSettled([
        api.get<Report>(`${TRACKER}/${key}`),
        api.get<Provenance>(`${TRACKER}/${key}/provenance`)
      ])

      if (rep.status === 'fulfilled') setReport(rep.value)
      else toastError(rep.reason, `Could not trace “${who}”`)
      if (pr.status === 'fulfilled') setProv(pr.value)
      else if (rep.status === 'fulfilled') toastError(pr.reason, 'Balance provenance did not load')
    } finally {
      setTraceLoading(false)
    }
  }

  const doAck = async (row: Finding) => {
    try {
      await api.post(`${TRACKER}/watchdog/${row.id}/acknowledge`)
      toast.success('Marked as being handled', { description: row.title || row.ref_key })
      void watchdog.refetch()
    } catch (err) {
      toastError(err, 'Could not mark it as handled')
      throw err
    }
  }

  const alertCount = alerts.data?.actionable ?? alerts.data?.totalIssues ?? 0
  const wdCount = watchdog.data?.count ?? 0

  const tabLabel = (label: string, badge: number) => (
    <>
      {label}
      {badge > 0 && (
        <Badge variant='destructive' className='ml-1'>
          {badge}
        </Badge>
      )}
    </>
  )

  return (
    <div>
      <PageHeader title='System Tracker' />

      <Card>
        <CardContent>
          {alerts.error && (
            <div className='mb-3'>
              <ErrorState error={alerts.error} title='Could not load the alerts' onRetry={alerts.refetch} retrying={alerts.isFetching} />
            </div>
          )}
          {watchdog.error && (
            <div className='mb-3'>
              <ErrorState error={watchdog.error} title='Could not load the watchdog' onRetry={watchdog.refetch} retrying={watchdog.isFetching} />
            </div>
          )}
          <Tabs value={tab} onValueChange={v => setTab(String(v))}>
            <TabsList className='mb-4'>
              <TabsTrigger value='alerts'>{tabLabel('Alerts', alertCount)}</TabsTrigger>
              <TabsTrigger value='trace'>{tabLabel('Account Trace', 0)}</TabsTrigger>
              <TabsTrigger value='watchdog'>{tabLabel('Watchdog', wdCount)}</TabsTrigger>
            </TabsList>
            <TabsContent value='alerts'>
              <AlertsTab data={alerts.data} onScan={doScan} scanning={scanning} onPick={pickAccount} />
            </TabsContent>
            <TabsContent value='trace'>
              <TraceTab
                query={query}
                setQuery={setQuery}
                report={report}
                prov={prov}
                onSearch={onSearch}
                suggestions={suggestions}
                onPick={pickAccount}
                loading={traceLoading}
              />
            </TabsContent>
            <TabsContent value='watchdog'>
              <WatchdogTab
                data={watchdog.data}
                onScan={doWatchdogScan}
                scanning={scanning}
                onAck={doAck}
                adminUrl={adminUrl}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}

export default SystemTracker
