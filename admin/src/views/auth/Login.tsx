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
    <div className='relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10 sm:px-6 lg:px-8'>
      {/* Soft brand glow plus Luno's isometric line pattern over the whole page, faded behind the content — our own drawing, not Luno's paths. */}
      <div
        aria-hidden='true'
        className='pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_15%_20%,color-mix(in_oklab,var(--primary)_14%,transparent),transparent_55%),radial-gradient(ellipse_at_85%_85%,color-mix(in_oklab,var(--brand-secondary)_14%,transparent),transparent_55%)]'
      />
      <svg
        aria-hidden='true'
        className='text-border pointer-events-none absolute inset-0 size-full [mask-image:radial-gradient(ellipse_at_center,transparent_25%,black_85%)]'
      >
        <defs>
          <pattern id='login-cubes' width='96' height='110' patternUnits='userSpaceOnUse'>
            <path
              d='M48 0 96 27.5V82.5L48 110 0 82.5V27.5ZM0 27.5 48 55 96 27.5M48 55V110'
              fill='none'
              stroke='currentColor'
              strokeWidth='1.5'
            />
          </pattern>
        </defs>
        <rect width='100%' height='100%' fill='url(#login-cubes)' />
      </svg>
      <div className='grid w-full max-w-[1140px] items-center gap-10 lg:grid-cols-2'>
        {/* Luno's sign-in: brand and a few lines about the panel on the left, the form card on the right. */}
        <div className='hidden lg:block lg:pl-6'>
          <BrandLogo fallback={<Logo className='[&_span]:text-heading gap-3 [&_span]:text-[28px] [&_span]:font-semibold [&>*:first-child]:size-11'/>} />
          <h1 className='text-heading mt-6 text-[32px] leading-tight font-medium'>{siteConfig.tagline}</h1>
        </div>

        <Card className='animate-in fade-in slide-in-from-bottom-4 z-1 mx-auto w-full max-w-[512px] gap-8 py-10 duration-500 motion-reduce:animate-none sm:px-6'>
          <CardHeader className='items-center gap-6 px-6 text-center'>
            <Logo className='justify-center gap-3 [&>*:first-child]:size-12' />
            <div>
              <CardTitle className='text-heading mb-2 text-[40px] leading-tight font-normal'>Sign in</CardTitle>
              <CardDescription className='text-base'>Staff sign-in to {siteConfig.name}</CardDescription>
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
                  <Button className='mt-2 h-11 w-auto self-center px-6 uppercase' type='submit' disabled={busy}>
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
