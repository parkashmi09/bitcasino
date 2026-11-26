'use client'

import { useState } from 'react'

import Link from 'next/link'

import { PencilIcon, PlusIcon, ShieldCheckIcon, Trash2Icon } from 'lucide-react'

import Can from '@/components/shared/Can'
import FormDialog from '@/components/shared/FormDialog'
import { SelectField, SwitchField, TextField } from '@/components/shared/FormField'
import ErrorState from '@/components/shared/ErrorState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { TxnPasswordLabel } from './StaffFloat'
import { useCurrencyCodes } from './useCurrencyCodes'

/**
 * Withdrawal limits (user-service `withdraw-controls`, migration 202).
 *
 *   Auto-send below   crypto: a request under it is sent through CCPayment at once; at or above it
 *                     waits in the queue for staff (transaction password).
 *   Per 24h count / amount, Max single   every payout rail (crypto, fiat gateway, manual).
 *
 * Site rule per currency; a player override replaces any value it sets (blank = the site's).
 */
const BASE = 'admin/user/withdrawals/controls'
const PLAYERS = `${BASE}/players`

type SiteRule = { currency: string; autoLimit: string | null; dailyCount: number | null; dailyAmount: string | null; maxSingle: string | null }
type PlayerRule = {
  userId: string
  username: string | null
  currency: string
  dailyCount: number | null
  dailyAmount: string | null
  maxSingle: string | null
  autoAllowed: boolean
  note: string | null
}

const INVALIDATE = [['api', BASE], ['api', PLAYERS]]

const AMOUNT_RE = /^\d{1,13}(\.\d{1,8})?$/
const amountError = (v: string, label: string) => (v.trim() && (!AMOUNT_RE.test(v.trim()) || Number(v) <= 0) ? `${label}: an amount above 0, up to 8 decimals` : undefined)
const countError = (v: string) => (v.trim() && (!/^\d+$/.test(v.trim()) || Number(v) < 1 || Number(v) > 1000) ? 'A whole number from 1 to 1000' : undefined)
const show = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? <span className='text-muted-foreground'>—</span> : String(v).replace(/\.?0+$/, ''))
const blank = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v).replace(/\.?0+$/, ''))
const orNull = (v: string) => (v.trim() ? v.trim() : null)

/** Add / edit the site's rule for one currency. */
const SiteRuleForm = ({ rule, rail }: { rule?: SiteRule; rail: 'crypto' | 'fiat' }) => {
  const codes = useCurrencyCodes()

  const [form, setForm] = useState({
    currency: rule?.currency ?? '',
    autoLimit: blank(rule?.autoLimit),
    dailyCount: blank(rule?.dailyCount),
    dailyAmount: blank(rule?.dailyAmount),
    maxSingle: blank(rule?.maxSingle),
    transactionPassword: ''
  })

  const save = useApiMutation({
    fn: () =>
      api.put(`${BASE}/site/${encodeURIComponent(form.currency)}`, {
        autoLimit: orNull(form.autoLimit),
        dailyCount: orNull(form.dailyCount),
        dailyAmount: orNull(form.dailyAmount),
        maxSingle: orNull(form.maxSingle),
        transactionPassword: form.transactionPassword
      }),
    invalidate: INVALIDATE,
    success: `Withdrawal limits for ${form.currency} saved`
  })

  return (
    <FormDialog
      trigger={
        rule ? (
          <Button size='sm' variant='ghost'>
            <PencilIcon /> Edit
          </Button>
        ) : (
          <Button size='sm' variant='outline'>
            <PlusIcon /> Add currency
          </Button>
        )
      }
      title={rule ? `Limits for ${rule.currency}` : 'Add a currency rule'}
      description='Leave a field blank for no limit. The caps apply to every payout rail.'
      onSubmit={() => save.mutateAsync()}
      validate={() => ({
        currency: form.currency ? undefined : 'Pick the currency',
        autoLimit: amountError(form.autoLimit, 'Auto-send limit'),
        dailyCount: countError(form.dailyCount),
        dailyAmount: amountError(form.dailyAmount, '24h amount'),
        maxSingle: amountError(form.maxSingle, 'Max single'),
        transactionPassword: form.transactionPassword ? undefined : 'Transaction password is required'
      })}
    >
      {rule ? null : (
        <SelectField id='wl-cur' name='currency' label='Currency' value={form.currency} onChange={currency => setForm({ ...form, currency })} options={codes.map(c => ({ value: c, label: c }))} />
      )}
      <TextField
        id='wl-auto'
        name='autoLimit'
        label='Auto-send below'
        inputMode='decimal'
        hint={rail === 'crypto' ? 'Crypto: a request BELOW this is sent through CCPayment with no staff step. At or above it, it waits for approval with the transaction password. Blank = auto-send off.' : 'Crypto only (sent through CCPayment). Blank = auto-send off.'}
        value={form.autoLimit}
        onChange={e => setForm({ ...form, autoLimit: e.target.value })}
      />
      <TextField id='wl-count' name='dailyCount' label='Withdrawals per 24 hours' inputMode='numeric' hint='How many withdrawals one player may make in any 24 hours' value={form.dailyCount} onChange={e => setForm({ ...form, dailyCount: e.target.value })} />
      <TextField id='wl-amount' name='dailyAmount' label='Amount per 24 hours' inputMode='decimal' hint='The total one player may withdraw in any 24 hours' value={form.dailyAmount} onChange={e => setForm({ ...form, dailyAmount: e.target.value })} />
      <TextField id='wl-max' name='maxSingle' label='Max single withdrawal' inputMode='decimal' value={form.maxSingle} onChange={e => setForm({ ...form, maxSingle: e.target.value })} />
      <TextField id='wl-tp' name='transactionPassword' label={<TxnPasswordLabel />} type='password' autoComplete='new-password' required value={form.transactionPassword} onChange={e => setForm({ ...form, transactionPassword: e.target.value })} />
    </FormDialog>
  )
}

/** Add / edit one player's override. */
const PlayerRuleForm = ({ rule }: { rule?: PlayerRule }) => {
  const codes = useCurrencyCodes()

  const [form, setForm] = useState({
    userId: rule?.userId ?? '',
    currency: rule?.currency ?? '',
    dailyCount: blank(rule?.dailyCount),
    dailyAmount: blank(rule?.dailyAmount),
    maxSingle: blank(rule?.maxSingle),
    autoAllowed: rule?.autoAllowed ?? true,
    note: rule?.note ?? '',
    transactionPassword: ''
  })

  const save = useApiMutation({
    fn: () =>
      api.put(`${PLAYERS}/${form.userId}/${encodeURIComponent(form.currency)}`, {
        dailyCount: orNull(form.dailyCount),
        dailyAmount: orNull(form.dailyAmount),
        maxSingle: orNull(form.maxSingle),
        autoAllowed: form.autoAllowed,
        note: orNull(form.note),
        transactionPassword: form.transactionPassword
      }),
    invalidate: INVALIDATE,
    success: `Limits for player #${form.userId} saved`
  })

  return (
    <FormDialog
      trigger={
        rule ? (
          <Button size='sm' variant='ghost'>
            <PencilIcon /> Edit
          </Button>
        ) : (
          <Button size='sm' variant='outline'>
            <PlusIcon /> Add player limit
          </Button>
        )
      }
      title={rule ? `Player #${rule.userId} · ${rule.currency}` : 'Add a player limit'}
      description="Overrides the site rule for this player. Blank = use the site's value."
      onSubmit={() => save.mutateAsync()}
      validate={() => ({
        userId: /^\d+$/.test(form.userId) ? undefined : 'Enter the player id',
        currency: form.currency ? undefined : 'Pick the currency',
        dailyCount: countError(form.dailyCount),
        dailyAmount: amountError(form.dailyAmount, '24h amount'),
        maxSingle: amountError(form.maxSingle, 'Max single'),
        note: form.note.length > 200 ? 'At most 200 characters' : undefined,
        transactionPassword: form.transactionPassword ? undefined : 'Transaction password is required'
      })}
    >
      {rule ? null : (
        <>
          <TextField id='pl-uid' name='userId' label='Player id' inputMode='numeric' value={form.userId} onChange={e => setForm({ ...form, userId: e.target.value.replace(/\D/g, '') })} />
          <SelectField id='pl-cur' name='currency' label='Currency' value={form.currency} onChange={currency => setForm({ ...form, currency })} options={codes.map(c => ({ value: c, label: c }))} />
        </>
      )}
      <TextField id='pl-count' name='dailyCount' label='Withdrawals per 24 hours' inputMode='numeric' value={form.dailyCount} onChange={e => setForm({ ...form, dailyCount: e.target.value })} />
      <TextField id='pl-amount' name='dailyAmount' label='Amount per 24 hours' inputMode='decimal' value={form.dailyAmount} onChange={e => setForm({ ...form, dailyAmount: e.target.value })} />
      <TextField id='pl-max' name='maxSingle' label='Max single withdrawal' inputMode='decimal' value={form.maxSingle} onChange={e => setForm({ ...form, maxSingle: e.target.value })} />
      <SwitchField id='pl-auto' label='Auto-send allowed' hint='Off: every crypto withdrawal of this player waits for staff approval, whatever the amount' checked={form.autoAllowed} onChange={autoAllowed => setForm({ ...form, autoAllowed })} />
      <TextField id='pl-note' name='note' label='Note' value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
      <TextField id='pl-tp' name='transactionPassword' label={<TxnPasswordLabel />} type='password' autoComplete='new-password' required value={form.transactionPassword} onChange={e => setForm({ ...form, transactionPassword: e.target.value })} />
    </FormDialog>
  )
}

/** Remove a site rule or a player override (transaction password). */
const RemoveRule = ({ path, what }: { path: string; what: string }) => {
  const [transactionPassword, setTransactionPassword] = useState('')

  const remove = useApiMutation({
    fn: () => api.delete(path, { transactionPassword }),
    invalidate: INVALIDATE,
    success: `${what} removed`
  })

  return (
    <FormDialog
      trigger={
        <Button size='sm' variant='ghost'>
          <Trash2Icon />
        </Button>
      }
      title={`Remove ${what}?`}
      description='The limits it set stop applying at once.'
      submitLabel='Remove'
      destructive
      validate={() => ({ transactionPassword: transactionPassword ? undefined : 'Transaction password is required' })}
      onSubmit={() => remove.mutateAsync()}
    >
      <TextField id={`rm-${path}`} name='transactionPassword' label={<TxnPasswordLabel />} type='password' autoComplete='new-password' required value={transactionPassword} onChange={e => setTransactionPassword(e.target.value)} />
    </FormDialog>
  )
}

const WithdrawLimits = ({ rail }: { rail: 'crypto' | 'fiat' }) => {
  const [open, setOpen] = useState(false)
  const [userId, setUserId] = useState('')
  const site = useApi<SiteRule[]>(open ? BASE : null)
  const players = useApi<{ total: number; rows: PlayerRule[] }>(open ? PLAYERS : null, userId ? { userId } : undefined)

  return (
    <Can permission='withdrawals:read'>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          render={
            <Button variant='outline' size='sm'>
              <ShieldCheckIcon /> Withdrawal limits
            </Button>
          }
        />
        <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-4xl'>
          <DialogHeader>
            <DialogTitle>Withdrawal limits</DialogTitle>
            <DialogDescription>
              Crypto below the auto-send limit goes out through CCPayment at once. At or above it, the request waits for approval with your transaction password. The 24-hour caps and the max single amount apply to crypto, fiat and manual withdrawals.
            </DialogDescription>
          </DialogHeader>

          <section className='space-y-2'>
            <div className='flex items-center justify-between'>
              <h3 className='text-sm font-medium'>Site rules (per currency)</h3>
              <Can permission='withdrawals:approve'>
                <SiteRuleForm rail={rail} />
              </Can>
            </div>
            {site.error ? (
              <ErrorState error={site.error} title='Could not load the limits' />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Currency</TableHead>
                    <TableHead className='text-right'>Auto-send below</TableHead>
                    <TableHead className='text-right'>Per 24h (count)</TableHead>
                    <TableHead className='text-right'>Per 24h (amount)</TableHead>
                    <TableHead className='text-right'>Max single</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(site.data ?? []).map(r => (
                    <TableRow key={r.currency}>
                      <TableCell className='font-medium'>{r.currency}</TableCell>
                      <TableCell className='text-right'>{show(r.autoLimit)}</TableCell>
                      <TableCell className='text-right'>{show(r.dailyCount)}</TableCell>
                      <TableCell className='text-right'>{show(r.dailyAmount)}</TableCell>
                      <TableCell className='text-right'>{show(r.maxSingle)}</TableCell>
                      <TableCell className='text-right'>
                        <Can permission='withdrawals:approve'>
                          <SiteRuleForm rule={r} rail={rail} />
                          <RemoveRule path={`${BASE}/site/${encodeURIComponent(r.currency)}`} what={`the ${r.currency} rule`} />
                        </Can>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!site.isLoading && !(site.data ?? []).length ? (
                    <TableRow>
                      <TableCell colSpan={6} className='text-muted-foreground py-6 text-center'>
                        No limits set — every withdrawal waits for staff, with no caps.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            )}
          </section>

          <section className='mt-6 space-y-2'>
            <div className='flex items-center justify-between gap-2'>
              <h3 className='text-sm font-medium'>Player overrides</h3>
              <div className='flex items-center gap-2'>
                <Input placeholder='User id' aria-label='Filter by user id' inputMode='numeric' value={userId} onChange={e => setUserId(e.target.value.replace(/\D/g, ''))} className='w-28' />
                <Can permission='withdrawals:approve'>
                  <PlayerRuleForm />
                </Can>
              </div>
            </div>
            {players.error ? (
              <ErrorState error={players.error} title='Could not load the player limits' />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Player</TableHead>
                    <TableHead>Currency</TableHead>
                    <TableHead className='text-right'>Per 24h (count)</TableHead>
                    <TableHead className='text-right'>Per 24h (amount)</TableHead>
                    <TableHead className='text-right'>Max single</TableHead>
                    <TableHead>Auto-send</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(players.data?.rows ?? []).map(r => (
                    <TableRow key={`${r.userId}-${r.currency}`}>
                      <TableCell>
                        <Link href={`/users/${r.userId}`} className='font-mono text-xs hover:underline'>
                          #{r.userId}
                        </Link>
                        {r.username ? <span className='text-muted-foreground ml-1 text-xs'>{r.username}</span> : null}
                      </TableCell>
                      <TableCell>{r.currency}</TableCell>
                      <TableCell className='text-right'>{show(r.dailyCount)}</TableCell>
                      <TableCell className='text-right'>{show(r.dailyAmount)}</TableCell>
                      <TableCell className='text-right'>{show(r.maxSingle)}</TableCell>
                      <TableCell>{r.autoAllowed ? <Badge variant='outline'>Allowed</Badge> : <Badge variant='destructive'>Always review</Badge>}</TableCell>
                      <TableCell className='max-w-40 truncate text-xs' title={r.note ?? ''}>
                        {r.note ?? ''}
                      </TableCell>
                      <TableCell className='text-right'>
                        <Can permission='withdrawals:approve'>
                          <PlayerRuleForm rule={r} />
                          <RemoveRule path={`${PLAYERS}/${r.userId}/${encodeURIComponent(r.currency)}`} what={`player #${r.userId}'s ${r.currency} limits`} />
                        </Can>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!players.isLoading && !(players.data?.rows ?? []).length ? (
                    <TableRow>
                      <TableCell colSpan={8} className='text-muted-foreground py-6 text-center'>
                        No player overrides.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            )}
          </section>
        </DialogContent>
      </Dialog>
    </Can>
  )
}

export default WithdrawLimits
