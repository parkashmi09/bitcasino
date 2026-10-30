'use client'

// React Imports
import { useEffect, useState } from 'react'

// Next Imports
import { useSearchParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'

// Third-party Imports
import { EyeIcon, EyeOffIcon, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

// Component Imports
import { BrandLogo } from '@/components/shared/BrandMark'
import Logo from '@/components/shared/Logo'
import OutlinedField from '@/components/shared/OutlinedField'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldError, FieldGroup } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Toaster } from '@/components/ui/sonner'

// Config Imports
import { siteConfig } from '@/configs/site'

// Lib Imports
import { ApiError, errorMessage, request } from '@/lib/api/client'
import { safeNext } from '@/lib/safeNext'
import { check, cleanErrors } from '@/lib/validate'

import IssuedTransactionPassword, { takeIssuedTransactionPassword } from './IssuedTransactionPassword'

type Mode = 'staff' | 'executive'

const Login = () => {
  const qc = useQueryClient()
  const params = useSearchParams()
  const [mode, setMode] = useState<Mode>('staff')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [needsCode, setNeedsCode] = useState(false)
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // First-login: the platform refuses with PASSWORD_CHANGE_REQUIRED until a new password is set.
  const [mustChange, setMustChange] = useState(false)
  const [newPassword, setNewPassword] = useState('')

  // The transaction password the first-sign-in change was just issued, shown once before signing in.
  const [issuedTxn, setIssuedTxn] = useState<string | null>(null)

  useEffect(() => {
    const code = takeIssuedTransactionPassword()

    // sessionStorage exists only after hydration, so it is read here, once.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (code) setIssuedTxn(code)
  }, [])

  // Live field checks: a field's message shows once it has been left (blur) or a submit was tried.
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [tried, setTried] = useState(false)

  const fieldErrors = cleanErrors({
    identifier: mode === 'staff' ? check.email(identifier, 'Email address') : check.required(identifier, 'Username'),
    password: check.required(password, 'Password'),
    newPassword: mustChange
      ? newPassword.length < 8
        ? 'The new password must be at least 8 characters.'
        : newPassword === password && 'Choose a new password different from the current one.'
      : undefined,
    code: needsCode && code && !/^\d{6}$/.test(code) ? 'The two-factor code is the 6 digits from your authenticator app.' : undefined
  })

  const shown = (key: string) => (tried || touched[key] ? fieldErrors[key] : undefined)
  const leave = (key: string) => () => setTouched(t => ({ ...t, [key]: true }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setTried(true)

    if (Object.keys(fieldErrors).length) return

    setBusy(true)

    try {
      if (mustChange) {
        await request('admin/auth/first-login-password', {
          method: 'POST',
          body: { email: identifier, currentPassword: password, newPassword }
        })
        toast.success('Password changed. Sign in with the new one.')
        setPassword('')
        setNewPassword('')
        setMustChange(false)

        return
      }

      const body: Record<string, string> = { mode, password }

      if (mode === 'staff') body.email = identifier
      else body.username = identifier
      if (code) body.twoFactorCode = code

      // Signed in through the same-origin proxy (API_URL, server-side): no CORS, no domain needed
      // locally. The admin server only keeps the token in its httpOnly cookie (app/api/auth/session).
      const payload = { ...body }

      delete payload.mode
      const path = mode === 'executive' ? '/api/v1/admin/auth/executive/login' : '/api/v1/admin/auth/login'

      const { data } = await request<{
        token: string
        firstLogin?: boolean
        mustChangePassword?: boolean
        actor?: { name?: string }
      }>(`/api/gw${path}`, { raw: true, method: 'POST', body: payload })

      await request('/api/auth/session', { raw: true, method: 'POST', body: { token: data.token } })

      toast.success(`Signed in${data?.actor?.name ? ` as ${data.actor.name}` : ''}`)

      /* A FULL PAGE LOAD, not a client-side route change.
         `/api/auth/me` 401s on the login screen and that failure sits in the
         query cache; carrying it into the app left the panel believing it had
         no permissions, so every nav item was filtered out and the sidebar
         showed "My account" alone until the operator reloaded by hand.
         Invalidating the query did not clear it either. Signing in happens
         once a session — starting the app from scratch is the cheap, certain
         fix. */
      qc.clear()

      // A password somebody else chose must be replaced before anything else opens.
      if (data?.mustChangePassword) return window.location.assign('/change-password')

      // Only a path on this site: `?next=javascript:…`, `?next=https://evil` or `?next=/%09/evil` in a
      // mailed link must not run or redirect after a staff sign-in.
      window.location.assign(safeNext(params.get('next')))
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.is('TWO_FACTOR_REQUIRED')) {
          setNeedsCode(true)
          setError(null)
          setBusy(false)

          return
        }

        if (err.is('PASSWORD_CHANGE_REQUIRED')) {
          setMustChange(true)
          setError('This account must set a new password before it can sign in.')
          setBusy(false)

          return
        }
      }

      setError(errorMessage(err))
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='relative flex min-h-screen overflow-hidden bg-(--login-bg) bg-[url(/images/login-pattern.svg)] bg-cover bg-center'>
      {/* ccpayment's sign-in: the whole page in primary blue with a tile pattern, brand and headline on the left,
          a white 16px card with the form on the right. */}
      <div className='hidden flex-1 flex-col justify-between p-[100px] pt-16 text-white lg:flex'>
        <BrandLogo fallback={<Logo className='gap-3 [&_span]:text-[28px] [&_span]:font-semibold [&_span]:text-white [&>*:first-child]:size-11' />} />
        <div>
          <h1 className='text-(--brand-lime) text-[72px] leading-[1.15] font-bold uppercase'>{siteConfig.name}</h1>
          <p className='mt-4 max-w-xl text-[36px] leading-tight font-semibold uppercase'>{siteConfig.tagline}</p>
        </div>
      </div>
      <div className='flex flex-1 items-center justify-center px-4 py-10 sm:px-6 lg:w-[580px] lg:flex-none lg:justify-start lg:py-[63px] lg:pr-[100px] lg:pl-0'>
        <Card className='animate-in fade-in slide-in-from-bottom-4 mx-auto w-full max-w-[480px] gap-8 py-14 shadow-none duration-500 motion-reduce:animate-none sm:px-[6px] lg:min-h-full lg:self-stretch lg:justify-center'>
          <CardHeader className='items-center gap-6 px-6 text-center'>
            <Logo className='justify-center gap-3 lg:hidden [&>*:first-child]:size-10' />
            <div>
              <CardTitle className='text-primary mb-2 text-[36px] leading-[54px] font-bold'>{issuedTxn ? 'Welcome' : 'Sign in'}</CardTitle>
              <CardDescription className='text-muted-foreground text-base font-medium'>
                {issuedTxn ? 'Note your transaction password, then sign in with your new password.' : `Staff sign-in to ${siteConfig.name}`}
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent className='px-6'>
            {issuedTxn ? (
              <IssuedTransactionPassword code={issuedTxn} onContinue={() => setIssuedTxn(null)} />
            ) : (
              <>
                <Tabs value={mode} onValueChange={v => setMode(v as Mode)} className='mb-6'>
                  <TabsList className='w-full'>
                    <TabsTrigger value='staff' className='flex-1'>
                      Staff
                    </TabsTrigger>
                    <TabsTrigger value='executive' className='flex-1'>
                      Executive
                    </TabsTrigger>
                  </TabsList>
                </Tabs>

                <form onSubmit={submit} noValidate>
                  <FieldGroup className='gap-8'>
                    <div className='flex flex-col gap-2'>
                      <OutlinedField htmlFor='identifier' label={mode === 'staff' ? 'Email' : 'Executive username'}>
                        <Input
                          id='identifier'
                          type={mode === 'staff' ? 'email' : 'text'}
                          autoComplete='username'
                          value={identifier}
                          onChange={e => setIdentifier(e.target.value)}
                            onBlur={leave('identifier')}
                            aria-invalid={!!shown('identifier')}
                          required
                          placeholder=' '
                          className='h-14 border-0 px-3.5 text-base'
                        />
                      </OutlinedField>
                      {shown('identifier') && <FieldError>{shown('identifier')}</FieldError>}
                    </div>

                    <div className='flex flex-col gap-2'>
                      <OutlinedField htmlFor='password' label={mustChange ? 'Current password' : 'Password'}>
                        <InputGroup className='h-14 border-0'>
                          <InputGroupInput
                            id='password'
                            type={visible ? 'text' : 'password'}
                            autoComplete='current-password'
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            onBlur={leave('password')}
                            aria-invalid={!!shown('password')}
                            required
                            placeholder=' '
                            className='h-14 px-3.5 text-base'
                          />
                          <InputGroupAddon align='inline-end' className='pr-1.5'>
                            <Button
                              type='button'
                              variant='ghost'
                              size='icon'
                              onClick={() => setVisible(v => !v)}
                              className='text-muted-foreground rounded-l-none hover:bg-transparent'
                            >
                              {visible ? <EyeOffIcon /> : <EyeIcon />}
                              <span className='sr-only'>{visible ? 'Hide password' : 'Show password'}</span>
                            </Button>
                          </InputGroupAddon>
                        </InputGroup>
                      </OutlinedField>
                      {shown('password') && <FieldError>{shown('password')}</FieldError>}
                    </div>

                    {mustChange && (
                      <div className='flex flex-col gap-2'>
                        <OutlinedField htmlFor='newPassword' label='New password'>
                          <Input
                            id='newPassword'
                            type='password'
                            autoComplete='new-password'
                            value={newPassword}
                            onChange={e => setNewPassword(e.target.value)}
                            onBlur={leave('newPassword')}
                            aria-invalid={!!shown('newPassword')}
                            required
                            minLength={8}
                            placeholder=' '
                            className='h-14 border-0 px-3.5 text-base'
                          />
                        </OutlinedField>
                        {shown('newPassword') && <FieldError>{shown('newPassword')}</FieldError>}
                      </div>
                    )}

                    {needsCode && (
                      <div className='flex flex-col gap-2'>
                        <OutlinedField htmlFor='code' label='Authenticator code'>
                          <Input
                            id='code'
                            inputMode='numeric'
                            pattern='[0-9]{6}'
                            maxLength={6}
                            value={code}
                            onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                            onBlur={leave('code')}
                            aria-invalid={!!shown('code')}
                            autoFocus
                            placeholder=' '
                            className='h-14 border-0 px-3.5 text-base'
                          />
                        </OutlinedField>
                        {shown('code') && <FieldError>{shown('code')}</FieldError>}
                      </div>
                    )}

                    {error && mustChange && (
                      <Alert variant='destructive'>
                        <AlertTitle>Sign-in failed</AlertTitle>
                        <AlertDescription>{error}</AlertDescription>
                      </Alert>
                    )}

                    <Field>
                      <Button className='mt-2 h-12 w-full rounded-lg text-base font-semibold capitalize' type='submit' disabled={busy}>
                        {busy && <Loader2Icon className='animate-spin' />}
                        {mustChange ? 'Set new password' : needsCode ? 'Verify and sign in' : 'Sign in'}
                      </Button>
                    </Field>
                  </FieldGroup>
                </form>
              </>
            )}
          </CardContent>
        </Card>
      </div>
      <Toaster />
    </div>
  )
}

export default Login
