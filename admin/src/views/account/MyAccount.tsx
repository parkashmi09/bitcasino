'use client'

import { useState } from 'react'

import { KeyRoundIcon, Loader2Icon, LockKeyholeIcon, ShieldCheckIcon, ShieldOffIcon } from 'lucide-react'
import { toast } from 'sonner'

import ErrorState from '@/components/shared/ErrorState'
import FormDialog from '@/components/shared/FormDialog'
import { TextField } from '@/components/shared/FormField'
import PageHeader from '@/components/shared/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useSession } from '@/contexts/SessionContext'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { check, cleanErrors, firstError, serverFieldErrors, type FieldErrors } from '@/lib/validate'

type TwoFactor = { enabled: boolean; enrolledAt?: string | null; pending?: boolean; required?: boolean }
type Begin = { secret?: string; otpauthUrl?: string; otpauth?: string; qr?: string; qrDataUrl?: string }

const MyAccount = () => {
  // Password and 2FA changes end every session of this account (staff.token_version), this one too.
  const { actor, signOut } = useSession()
  const status = useApi<TwoFactor>('admin/auth/2fa')
  const [setup, setSetup] = useState<Begin | null>(null)
  const [code, setCode] = useState('')
  const [pw, setPw] = useState({ oldPassword: '', newPassword: '', confirm: '' })
  const [disable, setDisable] = useState({ password: '', code: '' })
  const txnStatus = useApi<{ set: boolean; mode?: 'login' | 'separate' }>('admin/auth/transaction-password')
  const [txn, setTxn] = useState({ currentPassword: '', transactionPassword: '', confirm: '' })
  const [pwErrors, setPwErrors] = useState<Record<string, string>>({})
  const [txnErrors, setTxnErrors] = useState<Record<string, string>>({})

  /** Shows the messages inline and toasts the first; true when the form may be sent. */
  const passes = (errors: FieldErrors, show: (e: Record<string, string>) => void) => {
    const found = cleanErrors(errors)

    show(found)
    if (Object.keys(found).length) toast.error(firstError(found))

    return Object.keys(found).length === 0
  }

  const begin = useApiMutation({
    fn: () => api.post<Begin>('admin/auth/2fa/begin'),
    onSuccess: r => {
      setSetup(r)
      toast.info('Scan the code with your authenticator app, then enter the 6-digit code')
    }
  })

  const confirm = useApiMutation({
    fn: () => api.post('admin/auth/2fa/confirm', { code }),
    invalidate: [['api', 'admin/auth/2fa']],
    success: 'Two-factor authentication is on. Sign in again',
    onSuccess: () => {
      setSetup(null)
      setCode('')
      void signOut()
    }
  })

  const turnOff = useApiMutation({
    fn: () => api.post('admin/auth/2fa/disable', { password: disable.password, code: disable.code }),
    invalidate: [['api', 'admin/auth/2fa']],
    success: 'Two-factor authentication is off. Sign in again',
    onSuccess: () => void signOut()
  })

  const changePassword = useApiMutation({
    fn: () => api.patch('admin/staff/password', { oldPassword: pw.oldPassword, newPassword: pw.newPassword }),
    success: 'Password changed. Sign in again',
    onSuccess: () => void signOut()
  })

  const setTxnPassword = useApiMutation({
    fn: () => api.post('admin/auth/transaction-password', { currentPassword: txn.currentPassword, transactionPassword: txn.transactionPassword }),
    invalidate: [['api', 'admin/auth/transaction-password']],
    success: 'Transaction password saved',
    onSuccess: () => setTxn({ currentPassword: '', transactionPassword: '', confirm: '' })
  })

  const otpauth = setup?.otpauthUrl ?? setup?.otpauth
  const qr = setup?.qrDataUrl ?? setup?.qr

  return (
    <div>
      <PageHeader title='My account' description='Your staff identity on this site, your second factor, your password and your transaction password.' />
      <div className='grid gap-6 lg:grid-cols-2'>
        <Card className='shadow-none'>
          <CardHeader>
            <CardTitle className='text-base'>Identity</CardTitle>
          </CardHeader>
          <CardContent className='grid gap-2 text-sm'>
            <div className='flex justify-between'><span className='text-muted-foreground'>Staff id</span><span className='font-mono'>#{actor?.staffId}</span></div>
            <div className='flex justify-between'><span className='text-muted-foreground'>Role</span><span>{actor?.roleName} (level {actor?.level})</span></div>
            <div className='flex justify-between'><span className='text-muted-foreground'>Session expires</span><span>{actor?.expiresAt ? new Date(actor.expiresAt).toLocaleString() : '—'}</span></div>
            <div>
              <span className='text-muted-foreground'>Permissions</span>
              <div className='mt-1 flex flex-wrap gap-1'>
                {actor?.permissions.map(p => (
                  <Badge key={p} variant='outline' className='font-mono text-xs'>
                    {p}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className='shadow-none'>
          <CardHeader>
            <CardTitle className='flex items-center gap-2 text-base'>
              {status.data?.enabled ? <ShieldCheckIcon className='text-green-600' /> : <ShieldOffIcon className='text-muted-foreground' />}
              Two-factor authentication
            </CardTitle>
            <CardDescription>
              {status.data?.enabled ? 'On. Every sign-in asks for a 6-digit code.' : 'Off. Senior roles cannot sign in without it once STAFF_2FA_REQUIRED_LEVEL applies.'}
            </CardDescription>
          </CardHeader>
          <CardContent className='grid gap-3'>
            {status.error && <ErrorState error={status.error} title='Could not load your two-factor status' />}
            {!status.error && !status.data?.enabled && !setup && (
              <Button onClick={() => begin.mutate()} disabled={begin.isPending}>
                {begin.isPending && <Loader2Icon className='animate-spin' />}
                Start enrolment
              </Button>
            )}
            {setup && (
              <div className='grid gap-3'>
                {qr && <img src={qr} alt='Scan with your authenticator' className='size-44 rounded-md border bg-white p-2' />}
                {otpauth && <p className='text-muted-foreground text-xs break-all'>{otpauth}</p>}
                {setup.secret && <p className='text-sm'>Secret: <code>{setup.secret}</code></p>}
                <TextField id='code' label='Code from the app' inputMode='numeric' maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
                <div className='flex gap-2'>
                  <Button onClick={() => confirm.mutate()} disabled={code.length !== 6 || confirm.isPending}>
                    {confirm.isPending && <Loader2Icon className='animate-spin' />}
                    Confirm
                  </Button>
                  <Button variant='outline' onClick={() => setSetup(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            {status.data?.enabled && (
              <FormDialog
                trigger={<Button variant='destructive'>Turn off</Button>}
                title='Turn off two-factor'
                description='Needs your password and a current code, so a stolen session alone cannot remove it.'
                submitLabel='Turn off'
                destructive
                validate={() => ({
                  password: check.required(disable.password, 'Password'),
                  code: !/^\d{6}$/.test(disable.code.trim()) && 'Enter the 6-digit code from your authenticator app'
                })}
                onSubmit={() => turnOff.mutateAsync()}
              >
                <TextField id='d-pw' name='password' label='Password' type='password' required value={disable.password} onChange={e => setDisable({ ...disable, password: e.target.value })} />
                <TextField id='d-code' name='code' label='Current code' inputMode='numeric' maxLength={6} required value={disable.code} onChange={e => setDisable({ ...disable, code: e.target.value.replace(/\D/g, '') })} />
              </FormDialog>
            )}
          </CardContent>
        </Card>

        <Card className='shadow-none'>
          <CardHeader>
            <CardTitle className='flex items-center gap-2 text-base'>
              <KeyRoundIcon /> Change password
            </CardTitle>
            <CardDescription>At least 12 characters.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className='grid gap-3'
              onSubmit={e => {
                e.preventDefault()

                const ok = passes(
                  {
                    oldPassword: check.required(pw.oldPassword, 'Current password'),
                    newPassword: !pw.newPassword ? 'New password is required' : check.length(pw.newPassword, 'New password', { min: 12, max: 200 }) || (pw.newPassword === pw.oldPassword && 'Choose a password different from the current one'),
                    confirm: !pw.confirm ? 'Repeat the new password' : check.match(pw.newPassword, pw.confirm, 'The two new passwords do not match')
                  },
                  setPwErrors
                )

                if (ok) changePassword.mutate(undefined, { onError: err => setPwErrors(serverFieldErrors(err)) })
              }}
            >
              <TextField id='p-old' label='Current password' type='password' required error={pwErrors.oldPassword} value={pw.oldPassword} onChange={e => setPw({ ...pw, oldPassword: e.target.value })} />
              <TextField id='p-new' label='New password' type='password' required minLength={12} hint='At least 12 characters' error={pwErrors.newPassword} value={pw.newPassword} onChange={e => setPw({ ...pw, newPassword: e.target.value })} />
              <TextField id='p-confirm' label='Repeat new password' type='password' required minLength={12} error={pwErrors.confirm} value={pw.confirm} onChange={e => setPw({ ...pw, confirm: e.target.value })} />
              <Button type='submit' disabled={changePassword.isPending} className='justify-self-start'>
                {changePassword.isPending && <Loader2Icon className='animate-spin' />}
                Change password
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* TXN_PASSWORD_MODE=login (the backend default): money moves take the login password, so there is nothing to set. */}
        {txnStatus.data && txnStatus.data.mode === 'separate' && (
        <Card className='shadow-none'>
          <CardHeader>
            <CardTitle className='flex items-center gap-2 text-base'>
              <LockKeyholeIcon /> Transaction password
              {txnStatus.data && <Badge variant={txnStatus.data.set ? 'outline' : 'destructive'}>{txnStatus.data.set ? 'Set' : 'Not set'}</Badge>}
            </CardTitle>
            <CardDescription>
              A second password every money move asks for: balance adjustments, transfers and refills. Must differ from your login password. At least 6 characters.
              {actor?.executiveId ? ' An executive session cannot change it.' : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className='grid gap-3'
              onSubmit={e => {
                e.preventDefault()

                const ok = passes(
                  {
                    currentPassword: check.required(txn.currentPassword, 'Current login password'),
                    transactionPassword: !txn.transactionPassword ? 'Transaction password is required' : check.length(txn.transactionPassword, 'Transaction password', { min: 6, max: 128 }) || (txn.transactionPassword === txn.currentPassword && 'Must differ from your login password'),
                    confirm: !txn.confirm ? 'Repeat the transaction password' : check.match(txn.transactionPassword, txn.confirm, 'The two transaction passwords do not match')
                  },
                  setTxnErrors
                )

                if (ok) setTxnPassword.mutate(undefined, { onError: err => setTxnErrors(serverFieldErrors(err)) })
              }}
            >
              <TextField id='t-cur' label='Current login password' type='password' required error={txnErrors.currentPassword} value={txn.currentPassword} onChange={e => setTxn({ ...txn, currentPassword: e.target.value })} />
              <TextField id='t-new' label={txnStatus.data?.set ? 'New transaction password' : 'Transaction password'} type='password' required minLength={6} error={txnErrors.transactionPassword} value={txn.transactionPassword} onChange={e => setTxn({ ...txn, transactionPassword: e.target.value })} />
              <TextField id='t-confirm' label='Repeat it' type='password' required minLength={6} error={txnErrors.confirm} value={txn.confirm} onChange={e => setTxn({ ...txn, confirm: e.target.value })} />
              <Button type='submit' disabled={setTxnPassword.isPending || Boolean(actor?.executiveId)} className='justify-self-start'>
                {setTxnPassword.isPending && <Loader2Icon className='animate-spin' />}
                {txnStatus.data?.set ? 'Change transaction password' : 'Set transaction password'}
              </Button>
            </form>
          </CardContent>
        </Card>
        )}
      </div>
    </div>
  )
}

export default MyAccount
