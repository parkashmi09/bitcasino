'use client'

// React Imports
import { useState } from 'react'

// Next Imports
import { useSearchParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'

// Third-party Imports
import { EyeIcon, EyeOffIcon, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

// Component Imports
import { BrandLogo } from '@/components/shared/BrandMark'
import Logo from '@/components/shared/Logo'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Toaster } from '@/components/ui/sonner'

// Config Imports
import { siteConfig } from '@/configs/site'

// Lib Imports
import { ApiError, errorMessage, request } from '@/lib/api/client'

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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!identifier.trim() || !password)
      return setError(`Enter your ${mode === 'staff' ? 'email' : 'username'} and password.`)
    if (needsCode && code && !/^\d{6}$/.test(code.trim()))
      return setError('The two-factor code is the 6 digits from your authenticator app.')

    if (mustChange) {
      if (newPassword.length < 12) return setError('The new password must be at least 12 characters.')
      if (newPassword === password) return setError('Choose a new password different from the current one.')
    }

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

      // Signed in at the platform's base URL itself; the admin server only keeps the token in its
      // httpOnly cookie (app/api/auth/session).
      const payload = { ...body }

      delete payload.mode
      const path = mode === 'executive' ? '/api/v1/admin/auth/executive/login' : '/api/v1/admin/auth/login'

      const { data } = await request<{
        token: string
        firstLogin?: boolean
        mustChangePassword?: boolean
        actor?: { name?: string }
      }>(`${siteConfig.apiBaseUrl}${path}`, { raw: true, method: 'POST', body: payload })

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

      const next = params.get('next')

      if (next) return window.location.assign(next)

      window.location.assign('/dashboard')
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
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='bg-background flex min-h-screen'>
      {/* ccpayment's sign-in: a primary-blue brand panel on the left, the form on the page background on the right. */}
      <div className='bg-primary hidden w-[44%] max-w-[640px] flex-col justify-between p-12 text-white lg:flex'>
        <BrandLogo fallback={<Logo className='gap-3 [&_span]:text-[28px] [&_span]:font-semibold [&_span]:text-white [&>*:first-child]:size-11' />} />
        <div>
          <h1 className='text-[40px] leading-tight font-semibold'>{siteConfig.name}</h1>
          <p className='mt-4 max-w-md text-lg text-white/80'>{siteConfig.tagline}</p>
        </div>
        <p className='text-sm text-white/60'>© {new Date().getFullYear()} {siteConfig.name}</p>
      </div>
      <div className='flex flex-1 items-center justify-center px-4 py-10 sm:px-6'>
        <Card className='animate-in fade-in slide-in-from-bottom-4 mx-auto w-full max-w-[480px] gap-8 rounded-2xl py-10 shadow-(--shadow-card) duration-500 motion-reduce:animate-none sm:px-4'>
          <CardHeader className='gap-6 px-6'>
            <Logo className='gap-3 [&>*:first-child]:size-10' />
            <div>
              <CardTitle className='text-primary mb-2 text-[36px] leading-tight font-bold'>Sign in</CardTitle>
              <CardDescription className='text-sm'>Staff sign-in to {siteConfig.name}</CardDescription>
            </div>
          </CardHeader>

          <CardContent className='px-6'>
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

            <form onSubmit={submit}>
              <FieldGroup className='gap-4'>
                <Field className='gap-2'>
                  <FieldLabel htmlFor='identifier'>
                    {mode === 'staff' ? 'Email address' : 'Executive username'}
                  </FieldLabel>
                  <Input
                    id='identifier'
                    type={mode === 'staff' ? 'email' : 'text'}
                    autoComplete='username'
                    value={identifier}
                    onChange={e => setIdentifier(e.target.value)}
                    required
                    placeholder={mode === 'staff' ? 'admin@example.com' : 'username'}
                  />
                </Field>

                <Field className='w-full gap-2'>
                  <FieldLabel htmlFor='password'>{mustChange ? 'Current password' : 'Password'}</FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id='password'
                      type={visible ? 'text' : 'password'}
                      autoComplete='current-password'
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                      placeholder='••••••••••••'
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
                </Field>

                {mustChange && (
                  <Field className='gap-2'>
                    <FieldLabel htmlFor='newPassword'>New password</FieldLabel>
                    <Input
                      id='newPassword'
                      type='password'
                      autoComplete='new-password'
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      required
                      minLength={8}
                    />
                  </Field>
                )}

                {needsCode && (
                  <Field className='gap-2'>
                    <FieldLabel htmlFor='code'>Authenticator code</FieldLabel>
                    <Input
                      id='code'
                      inputMode='numeric'
                      pattern='[0-9]{6}'
                      maxLength={6}
                      value={code}
                      onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                      autoFocus
                      placeholder='123456'
                    />
                  </Field>
                )}

                {error && (
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
          </CardContent>
        </Card>
      </div>
      <Toaster />
    </div>
  )
}

export default Login
