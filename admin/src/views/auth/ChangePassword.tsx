'use client'

// React Imports
import { useState } from 'react'

// Third-party Imports
import { Loader2Icon } from 'lucide-react'

// Component Imports
import Logo from '@/components/shared/Logo'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

// Config Imports
import { siteConfig } from '@/configs/site'

// Context Imports
import { useSession } from '@/contexts/SessionContext'

// Lib Imports
import { errorMessage, request } from '@/lib/api/client'

import { keepIssuedTransactionPassword } from './IssuedTransactionPassword'

// SVG Import
import AuthBackgroundShape from '@/assets/svg/auth-background-shape'

/**
 * The first-sign-in password change. A staff account created (or reset) by somebody above it
 * carries a password that person chose; the platform answers every admin API with 403
 * PASSWORD_CHANGE_REQUIRED until the owner sets their own here. Only "who am I", this change and
 * sign-out stay open.
 */
const ChangePassword = () => {
  const { actor, signOut } = useSession()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')

  // Whitelabel company (Super Admin only): chooses its own 6-digit transaction code on this screen (no issued one).
  const [code, setCode] = useState('')
  const [codeAgain, setCodeAgain] = useState('')
  const chooseCode = siteConfig.whitelabel && actor?.level === 1
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (next.length < 8) return setError('The new password must be at least 8 characters.')
    if (next !== confirm) return setError('The two new passwords do not match.')
    if (next === current) return setError('Choose a password different from the one you were given.')
    if (chooseCode && !/^\d{6}$/.test(code)) return setError('The transaction code must be 6 digits.')
    if (chooseCode && code !== codeAgain) return setError('The two transaction codes do not match.')

    setBusy(true)

    try {
      const { data } = await request<{ transactionPassword?: string }>('admin/staff/password', {
        method: 'PATCH',
        body: { oldPassword: current, newPassword: next, ...(chooseCode ? { transactionPassword: code } : {}) }
      })

      // A first sign-in is issued its transaction password; the login screen shows it once.
      if (data?.transactionPassword) keepIssuedTransactionPassword(data.transactionPassword)

      // The change ends every session of this account (staff.token_version), this one too: sign in
      // again with the new password. signOut clears the cookie and the query cache.
      await signOut()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <div className='relative flex h-auto min-h-screen items-center justify-center overflow-x-hidden px-4 py-10 sm:px-6 lg:px-8'>
      <div className='absolute'>
        <AuthBackgroundShape />
      </div>

      <Card className='z-1 w-full gap-6 py-6 sm:max-w-md'>
        <CardHeader className='gap-6 px-6'>
          <Logo className='gap-3' />
          <div>
            <CardTitle className='mb-2 text-2xl font-semibold'>Set your own password</CardTitle>
            <CardDescription className='text-base'>
              {actor?.name ? `${actor.name}, your` : 'Your'} account was given a temporary password. Choose a new one{chooseCode ? ' and your transaction code' : ''} to continue.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className='px-6'>
          <form onSubmit={submit}>
            <FieldGroup className='gap-4'>
              <Field className='gap-2'>
                <FieldLabel htmlFor='current'>Current password</FieldLabel>
                <Input id='current' type='password' autoComplete='current-password' required value={current} onChange={e => setCurrent(e.target.value)} />
              </Field>
              <Field className='gap-2'>
                <FieldLabel htmlFor='next'>New password</FieldLabel>
                <Input id='next' type='password' autoComplete='new-password' required minLength={8} value={next} onChange={e => setNext(e.target.value)} />
              </Field>
              <Field className='gap-2'>
                <FieldLabel htmlFor='confirm'>Repeat new password</FieldLabel>
                <Input id='confirm' type='password' autoComplete='new-password' required minLength={8} value={confirm} onChange={e => setConfirm(e.target.value)} />
              </Field>
              {chooseCode && (
                <>
                  <Field className='gap-2'>
                    <FieldLabel htmlFor='code'>Transaction code (6 digits)</FieldLabel>
                    <Input id='code' type='password' inputMode='numeric' autoComplete='off' required maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
                  </Field>
                  <Field className='gap-2'>
                    <FieldLabel htmlFor='code-again'>Repeat transaction code</FieldLabel>
                    <Input id='code-again' type='password' inputMode='numeric' autoComplete='off' required maxLength={6} value={codeAgain} onChange={e => setCodeAgain(e.target.value.replace(/\D/g, ''))} />
                  </Field>
                </>
              )}

              {error && (
                <Alert variant='destructive'>
                  <AlertTitle>Password not changed</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Field>
                <Button className='w-full' type='submit' disabled={busy}>
                  {busy && <Loader2Icon className='animate-spin' />}
                  Set password and continue
                </Button>
              </Field>
              <Button type='button' variant='ghost' className='w-full' onClick={() => void signOut()}>
                Sign out
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

export default ChangePassword
