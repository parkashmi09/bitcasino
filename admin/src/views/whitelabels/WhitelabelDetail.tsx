'use client'

import { useState, type ReactNode } from 'react'

import { useRouter } from 'next/navigation'

import { ArrowLeftRightIcon, BanknoteIcon, ExternalLinkIcon, EyeIcon, KeyRoundIcon, Loader2Icon, PowerIcon, RotateCwIcon, Trash2Icon, UsersIcon, WalletIcon } from 'lucide-react'

import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import FormDialog from '@/components/shared/FormDialog'
import { SwitchField, TextAreaField, TextField } from '@/components/shared/FormField'
import Money from '@/components/shared/Money'
import PageHeader from '@/components/shared/PageHeader'
import StatCard from '@/components/shared/StatCard'
import StatusBadge from '@/components/shared/StatusBadge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { check } from '@/lib/validate'
import { TxnPasswordLabel } from '@/views/finance/StaffFloat'

import ImageField, { POSTER, type PickedImage } from './ImageField'
import PaletteEditor, { paletteError, type ThemeValue } from './PaletteEditor'
import { TEMPLATE_PALETTES } from './palettes'
import { PALETTE_KEYS, type Palette, type WhitelabelDetail as Detail, type WhitelabelTransfer } from './types'

const BUSY = ['queued', 'creating', 'deleting']

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className='flex justify-between gap-4 border-b py-2 text-sm last:border-0'>
    <span className='text-muted-foreground'>{label}</span>
    <span className='min-w-0 truncate text-right'>{children}</span>
  </div>
)

const SendBalance = ({ wl, invalidate }: { wl: Detail; invalidate: string[][] }) => {
  const empty = { amount: '', note: '', transactionPassword: '' }
  const [form, setForm] = useState(empty)

  const send = useApiMutation({
    fn: () =>
      api.post<WhitelabelTransfer>(`admin/whitelabels/${wl.id}/transfers`, {
        amount: form.amount.trim(),
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
        transactionPassword: form.transactionPassword
      }),
    invalidate: [...invalidate, ['api', 'admin/exchange/owner/wallet']],
    success: t =>
      t.status === 'done'
        ? `${Number(t.amount).toLocaleString()} sent to ${wl.name}`
        : t.status === 'refunded'
          ? `Refused by the whitelabel — given back to your Direct balance`
          : `Debited — not delivered yet; it is sent again automatically`,
    onSuccess: () => setForm(empty)
  })

  return (
    <FormDialog
      trigger={
        <Button>
          <ArrowLeftRightIcon /> Send balance
        </Button>
      }
      title={`Send balance to ${wl.name}`}
      description={`From your Direct Users balance to the company’s Direct Users balance. ${wl.companyName} then moves it to its Agent System balance to fund its agents.`}
      submitLabel='Send'
      validate={() => ({
        'wl-amount': check.number(form.amount, 'Amount', { positive: true, decimals: 2 }),
        'wl-note': check.length(form.note, 'Remark', { max: 200 }),
        'wl-tp': check.required(form.transactionPassword, 'Transaction code')
      })}
      onSubmit={() => send.mutateAsync()}
    >
      <TextField id='wl-amount' label='Amount (INR)' required value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
      <TextAreaField id='wl-note' label='Remark (optional)' maxLength={200} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
      <TextField id='wl-tp' label={<TxnPasswordLabel />} type='password' required value={form.transactionPassword} onChange={e => setForm({ ...form, transactionPassword: e.target.value })} />
    </FormDialog>
  )
}

const CompanyPassword = ({ wl }: { wl: Detail }) => {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')

  const change = useApiMutation({
    fn: () => api.put(`admin/whitelabels/${wl.id}/company-password`, { password }),
    success: wl.status === 'live' ? 'Password changed — the company is signed out' : 'Password saved for the setup',
    onSuccess: () => {
      setPassword('')
      setConfirm('')
    }
  })

  return (
    <FormDialog
      trigger={
        <Button variant='outline' size='sm'>
          <KeyRoundIcon /> Change password
        </Button>
      }
      title={`New password for ${wl.companyName}`}
      description='The company is signed out, and on its next sign-in must choose its own password and a new transaction code.'
      submitLabel='Change'
      validate={() => ({
        'wl-cpw': !password ? 'Password is required' : check.length(password, 'Password', { min: 8, max: 72 }),
        'wl-cpw2': check.match(password, confirm, 'Passwords do not match')
      })}
      onSubmit={() => change.mutateAsync()}
    >
      <TextField id='wl-cpw' label='New password' type='password' autoComplete='new-password' required value={password} onChange={e => setPassword(e.target.value)} />
      <TextField id='wl-cpw2' label='Confirm password' type='password' autoComplete='new-password' required value={confirm} onChange={e => setConfirm(e.target.value)} />
    </FormDialog>
  )
}

const DeleteWhitelabel = ({ wl }: { wl: Detail }) => {
  const router = useRouter()
  const [name, setName] = useState('')
  const [acknowledge, setAcknowledge] = useState(false)
  const s = wl.summary
  const holdsMoney = Boolean(s && (Object.values(s.balances).some(v => Number(v) !== 0) || s.counts.playersWithBalance > 0))
  const mustBeOff = wl.status === 'live' && !wl.maintenance

  const remove = useApiMutation({
    fn: () => api.delete(`admin/whitelabels/${wl.id}`, { confirmName: name, ...(acknowledge ? { acknowledgeBalances: true } : {}) }),
    invalidate: [['paged', 'admin/whitelabels']],
    success: wl.status === 'queued' ? 'Whitelabel cancelled' : 'Delete queued — a final database export is kept',
    onSuccess: () => router.push('/whitelabels')
  })

  return (
    <FormDialog
      trigger={
        <Button variant='outline' className='text-destructive'>
          <Trash2Icon /> Delete
        </Button>
      }
      title={`Delete ${wl.name}?`}
      description='Removes its processes, folder, database, Redis data, Apache sites and certificates. A final database export is kept on the server. This cannot be undone.'
      submitLabel='Delete for good'
      destructive
      submitDisabled={mustBeOff || name !== wl.name || (holdsMoney && !acknowledge)}
      validate={() => ({ 'wl-del-name': name === wl.name ? undefined : 'Type the name exactly' })}
      onSubmit={() => remove.mutateAsync()}
    >
      {mustBeOff && (
        <Alert variant='destructive'>
          <AlertTitle>Switch it off first</AlertTitle>
          <AlertDescription>Turn the whitelabel off (maintenance) before deleting it.</AlertDescription>
        </Alert>
      )}
      {(holdsMoney || (wl.status === 'live' && !s)) && (
        <Alert variant='destructive'>
          <AlertTitle>{s ? 'Money is still held on this whitelabel' : 'Its balances could not be read'}</AlertTitle>
          <AlertDescription>
            {s ? (
              <>
                Company Direct <Money value={s.balances.direct} />, Agent System <Money value={s.balances.agentSystem} />, agents <Money value={s.balances.staff} />, players{' '}
                <Money value={s.balances.players} /> ({s.counts.playersWithBalance} players with a balance in any coin).
              </>
            ) : (
              wl.summaryError
            )}
          </AlertDescription>
        </Alert>
      )}
      {(holdsMoney || (wl.status === 'live' && !s)) && (
        <SwitchField id='wl-del-ack' label='Delete it anyway' hint='Those balances are lost with the whitelabel (they stay in the final export).' checked={acknowledge} onChange={setAcknowledge} />
      )}
      <TextField id='wl-del-name' label={`Type “${wl.name}” to confirm`} required value={name} onChange={e => setName(e.target.value)} />
    </FormDialog>
  )
}

const BrandImages = ({ wl, invalidate }: { wl: Detail; invalidate: string[][] }) => {
  const [logo, setLogo] = useState<PickedImage | null>(null)
  const [icon, setIcon] = useState<PickedImage | null>(null)
  const [error, setError] = useState('')
  const stored = (which: 'logo' | 'icon') => `/api/gw/api/v1/admin/whitelabels/${wl.id}/${which}?v=${encodeURIComponent(wl.updatedAt)}`

  const save = useApiMutation({
    fn: () =>
      api.put(`admin/whitelabels/${wl.id}/branding`, {
        ...(logo ? { logo: { type: logo.type, data: logo.data } } : {}),
        ...(icon ? { icon: { type: icon.type, data: icon.data } } : {})
      }),
    invalidate,
    success: wl.status === 'live' ? 'Saved — the whitelabel shows it on its next page load' : 'Saved for the setup',
    onSuccess: () => {
      setLogo(null)
      setIcon(null)
    }
  })

  return (
    <Card>
      <CardHeader className='flex flex-row items-start justify-between gap-4'>
        <div>
          <CardTitle>Logo & icon</CardTitle>
          <CardDescription>The icon is the favicon and the small icon in both panels; without one the logo is used.</CardDescription>
        </div>
        <Button size='sm' disabled={save.isPending || (!logo && !icon)} onClick={() => save.mutate()}>
          {save.isPending && <Loader2Icon className='animate-spin' />} Save images
        </Button>
      </CardHeader>
      <CardContent className='grid gap-4 sm:grid-cols-2'>
        <ImageField label='Logo' hint='PNG, WebP or SVG, at most 256 KB.' value={logo} onChange={setLogo} onError={setError} current={wl.hasLogo ? stored('logo') : null} />
        <ImageField label='Icon' hint='Square, at most 256 KB.' value={icon} onChange={setIcon} onError={setError} current={wl.hasIcon ? stored('icon') : null} square />
        {error && <span className='text-destructive text-sm sm:col-span-2'>{error}</span>}
      </CardContent>
    </Card>
  )
}

const samePalette = (a: Palette, b: Palette) => PALETTE_KEYS.every(k => a[k].toLowerCase() === b[k].toLowerCase())

/**
 * A copy's built-in template (`wl.template`) is fixed when it is built, so another template is
 * sent as that template's 13 colours. Shown back as that template, not as custom colours.
 */
const shownTheme = (wl: Detail): ThemeValue => {
  if (!wl.palette) return { template: wl.template, palette: null }
  const match = Object.keys(TEMPLATE_PALETTES).find(k => samePalette(TEMPLATE_PALETTES[k], wl.palette as Palette))

  return match ? { template: match, palette: null } : { template: wl.template, palette: wl.palette }
}

const Poster = ({ wl, invalidate }: { wl: Detail; invalidate: string[][] }) => {
  const [desktop, setDesktop] = useState<PickedImage | null>(null)
  const [mobile, setMobile] = useState<PickedImage | null>(null)
  const [error, setError] = useState('')
  const stored = (slot: string) => (wl.posters?.[slot] ? `/api/gw/api/v1/admin/whitelabels/${wl.id}/poster/${slot}?v=${encodeURIComponent(wl.posters[slot])}` : null)

  const save = useApiMutation({
    fn: () =>
      api.put(`admin/whitelabels/${wl.id}/poster`, {
        ...(desktop ? { desktop: { type: desktop.type, data: desktop.data } } : {}),
        ...(mobile ? { mobile: { type: mobile.type, data: mobile.data } } : {})
      }),
    invalidate,
    success: wl.status === 'live' ? 'Poster saved — the player site shows it on its next page load' : 'Poster saved for the setup',
    onSuccess: () => {
      setDesktop(null)
      setMobile(null)
    }
  })

  return (
    <Card>
      <CardHeader className='flex flex-row items-start justify-between gap-4'>
        <div>
          <CardTitle>Home poster</CardTitle>
          <CardDescription>The big picture at the top of the player site. Without one it shows the logo on the brand colours.</CardDescription>
        </div>
        <Button size='sm' disabled={save.isPending || (!desktop && !mobile)} onClick={() => save.mutate()}>
          {save.isPending && <Loader2Icon className='animate-spin' />} Save poster
        </Button>
      </CardHeader>
      <CardContent className='grid gap-4 sm:grid-cols-2'>
        <ImageField label='Desktop' hint='About 1276×270, at most 600 KB.' value={desktop} onChange={setDesktop} onError={setError} current={stored('poster')} {...POSTER} />
        <ImageField label='Phone' hint='About 372×215. Without one: the desktop poster.' value={mobile} onChange={setMobile} onError={setError} current={stored('poster_mobile')} {...POSTER} />
        {error && <span className='text-destructive text-sm sm:col-span-2'>{error}</span>}
      </CardContent>
    </Card>
  )
}

const Colours = ({ wl, invalidate }: { wl: Detail; invalidate: string[][] }) => {
  const [theme, setTheme] = useState<ThemeValue>(() => shownTheme(wl))
  const error = paletteError(theme.palette)

  const save = useApiMutation({
    fn: () =>
      api.put(`admin/whitelabels/${wl.id}/palette`, {
        palette: theme.palette ?? (theme.template === wl.template ? null : TEMPLATE_PALETTES[theme.template])
      }),
    invalidate,
    success: wl.status === 'live' ? 'Colours saved — the player site shows them on its next load' : 'Colours saved for the setup'
  })

  return (
    <Card>
      <CardHeader className='flex flex-row items-start justify-between gap-4'>
        <div>
          <CardTitle>Player site colours</CardTitle>
          <CardDescription>Change the template or any colour at any time; the player site shows it on its next page load.</CardDescription>
        </div>
        <Button size='sm' disabled={save.isPending || Boolean(error)} onClick={() => save.mutate()}>
          {save.isPending && <Loader2Icon className='animate-spin' />} Save colours
        </Button>
      </CardHeader>
      <CardContent className='grid gap-2'>
        <PaletteEditor
          value={theme}
          onChange={setTheme}
          name={wl.name}
          logoUrl={wl.hasLogo ? `/api/gw/api/v1/admin/whitelabels/${wl.id}/logo` : null}
        />
        {error && <span className='text-destructive text-sm'>{error}</span>}
      </CardContent>
    </Card>
  )
}

const WhitelabelDetail = ({ id }: { id: string }) => {
  const path = `admin/whitelabels/${id}`
  const invalidate = [['api', path]]

  // Setup / delete in progress: follow it.
  const detail = useApi<Detail>(path, undefined, { refetchInterval: q => (BUSY.includes(q.state.data?.status ?? '') ? 3000 : false) })
  const wl = detail.data

  const toggle = useApiMutation({
    fn: () => api.put(`${path}/maintenance`, { on: !wl?.maintenance }),
    invalidate,
    success: () => (wl?.maintenance ? 'Whitelabel switched on' : 'Whitelabel switched off — players and staff see maintenance')
  })

  const preview = useApiMutation({
    fn: () => api.post<{ url: string }>(`${path}/preview`),
    onSuccess: r => window.open(r.url, '_blank', 'noopener')
  })

  const retrySetup = useApiMutation({ fn: () => api.post(`${path}/retry-setup`), invalidate, success: 'Setup queued again' })
  const resend = useApiMutation({ fn: () => api.post<{ retried: number }>(`${path}/transfers/retry`), invalidate, success: r => `${r.retried} transfer(s) sent again` })

  if (detail.isLoading) return <p className='text-muted-foreground text-sm'>Loading…</p>
  if (!wl) return <p className='text-destructive text-sm'>{detail.error ? String((detail.error as Error).message) : 'Whitelabel not found'}</p>

  const live = wl.status === 'live'
  const s = wl.summary
  const job = wl.jobs[0]
  const pending = wl.transfers.some(t => t.status === 'pending')

  const transferColumns: Column<WhitelabelTransfer>[] = [
    { key: 'created', header: 'When', cell: r => <DateTime value={r.createdAt} /> },
    { key: 'amount', header: 'Amount', align: 'right', cell: r => <Money value={r.amount} /> },
    {
      key: 'status',
      header: 'Status',
      cell: r => (
        <div className='flex items-center gap-1.5'>
          <StatusBadge value={r.status} />
          {r.status === 'pending' && r.uncertain && <Badge variant='outline' title='An attempt had no answer: never refunded automatically'>unconfirmed</Badge>}
        </div>
      )
    },
    { key: 'note', header: 'Remark', cell: r => <span className='text-muted-foreground'>{r.note ?? '—'}</span> },
    { key: 'error', header: 'Last error', cell: r => <span className='text-muted-foreground text-xs'>{r.status === 'done' ? '' : (r.error ?? '')}</span> }
  ]

  return (
    <div className='grid gap-6'>
      <PageHeader
        title={wl.name}
        description={
          <span className='flex flex-wrap items-center gap-2'>
            <StatusBadge value={wl.status} />
            {live && <Badge variant={wl.maintenance ? 'destructive' : 'outline'}>{wl.maintenance ? 'Off (maintenance)' : 'On'}</Badge>}
            <span className='font-mono text-xs'>{wl.slug}</span>
          </span>
        }
        actions={
          <div className='flex flex-wrap gap-2'>
            {live && (
              <>
                <Button variant='outline' disabled={preview.isPending} onClick={() => preview.mutate()}>
                  {preview.isPending ? <Loader2Icon className='animate-spin' /> : <EyeIcon />} Preview admin
                </Button>
                <Button variant='outline' nativeButton={false} render={<a href={`https://${wl.siteDomain}`} target='_blank' rel='noopener noreferrer' />}>
                  <ExternalLinkIcon /> Open site
                </Button>
                <Button variant={wl.maintenance ? 'default' : 'outline'} disabled={toggle.isPending} onClick={() => toggle.mutate()}>
                  <PowerIcon /> {wl.maintenance ? 'Switch on' : 'Switch off'}
                </Button>
                <SendBalance wl={wl} invalidate={invalidate} />
              </>
            )}
            {!['creating', 'deleting'].includes(wl.status) && <DeleteWhitelabel wl={wl} />}
          </div>
        }
      />

      {!live && job && (
        <Card>
          <CardHeader className='flex flex-row items-start justify-between gap-4'>
            <div>
              <CardTitle>{job.kind === 'create' ? 'Setup' : 'Delete'}: {job.status}</CardTitle>
              <CardDescription>
                {job.step ?? (job.status === 'queued' ? 'Waiting for the setup script to pick it up.' : '')} {job.startedAt && <>· started <DateTime value={job.startedAt} relative /></>}
              </CardDescription>
            </div>
            {wl.status === 'failed' && job.kind === 'create' && (
              <Button size='sm' disabled={retrySetup.isPending} onClick={() => retrySetup.mutate()}>
                <RotateCwIcon /> Run setup again
              </Button>
            )}
            {wl.status === 'failed' && job.kind === 'delete' && <span className='text-muted-foreground text-sm'>Press Delete to run it again.</span>}
          </CardHeader>
          {job.log && (
            <CardContent>
              <pre className='bg-muted max-h-80 overflow-auto rounded p-3 text-xs whitespace-pre-wrap'>{job.log}</pre>
            </CardContent>
          )}
        </Card>
      )}

      {live && (
        <>
          {wl.summaryError && (
            <Alert variant='destructive'>
              <AlertTitle>The whitelabel did not answer</AlertTitle>
              <AlertDescription>{wl.summaryError}</AlertDescription>
            </Alert>
          )}
          <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
            <StatCard label='Company Direct balance' value={<Money value={s?.balances.direct} />} hint={<>Received in total <Money value={s?.received} /></>} icon={<WalletIcon />} loading={!s && !wl.summaryError} />
            <StatCard label='Company Agent System' value={<Money value={s?.balances.agentSystem} />} hint='Funds its agents' icon={<BanknoteIcon />} loading={!s && !wl.summaryError} />
            <StatCard label='Agents & players hold' value={<Money value={s ? Number(s.balances.staff) + Number(s.balances.players) : null} />} hint={s ? `${s.counts.playersWithBalance} players with a balance` : undefined} icon={<BanknoteIcon />} loading={!s && !wl.summaryError} />
            <StatCard label='Accounts' value={s ? s.counts.directUsers + s.counts.clientUsers : '—'} hint={s ? `${s.counts.directUsers} direct · ${s.counts.clientUsers} agent players · ${s.counts.staff} staff` : undefined} icon={<UsersIcon />} loading={!s && !wl.summaryError} />
          </div>
        </>
      )}

      <div className='grid gap-6 lg:grid-cols-2'>
        <Card>
          <CardHeader className='flex flex-row items-start justify-between gap-4'>
            <div>
              <CardTitle>Company</CardTitle>
              <CardDescription>Its top account on the whitelabel.</CardDescription>
            </div>
            {!['creating', 'deleting'].includes(wl.status) && <CompanyPassword wl={wl} />}
          </CardHeader>
          <CardContent>
            <Row label='Hierarchy name'>{wl.companyRoleName}</Row>
            <Row label='Company'>{wl.companyName}</Row>
            <Row label='Login email'>{wl.companyEmail}</Row>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Domains</CardTitle>
            <CardDescription>Created <DateTime value={wl.createdAt} /></CardDescription>
          </CardHeader>
          <CardContent>
            <Row label='Player site'>{wl.siteDomain}</Row>
            <Row label='Admin panel'>{wl.adminDomain}</Row>
            <Row label='API'>{wl.apiDomain}</Row>
            <Row label='Folder'>/var/www/main/{wl.slug}</Row>
          </CardContent>
        </Card>
      </div>

      {live && (
        <Card>
          <CardHeader className='flex flex-row items-start justify-between gap-4'>
            <div>
              <CardTitle>Transfers to the company</CardTitle>
              <CardDescription>A transfer that did not get through is sent again when this page opens; one the whitelabel refused is given back.</CardDescription>
            </div>
            {pending && (
              <Button size='sm' variant='outline' disabled={resend.isPending} onClick={() => resend.mutate()}>
                <RotateCwIcon /> Send pending again
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <DataTable columns={transferColumns} rows={wl.transfers} rowKey={r => r.id} loading={false} emptyMessage='No transfers yet. Use Send balance.' />
          </CardContent>
        </Card>
      )}

      {!['creating', 'deleting'].includes(wl.status) && <BrandImages wl={wl} invalidate={invalidate} />}
      {!['creating', 'deleting'].includes(wl.status) && <Poster wl={wl} invalidate={invalidate} />}
      {wl.status !== 'deleting' && <Colours key={wl.updatedAt} wl={wl} invalidate={invalidate} />}
    </div>
  )
}

export default WhitelabelDetail
