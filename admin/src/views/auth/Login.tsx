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
import OutlinedField from '@/components/shared/OutlinedField'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup } from '@/components/ui/field'
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
    <div className='bg-primary relative flex min-h-screen overflow-hidden bg-[url(/images/login-pattern.svg)] bg-cover bg-center'>
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
              <CardTitle className='text-primary mb-2 text-[36px] leading-[54px] font-bold'>Sign in</CardTitle>
              <CardDescription className='text-muted-foreground text-base font-medium'>Staff sign-in to {siteConfig.name}</CardDescription>
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
              <FieldGroup className='gap-8'>
                <OutlinedField htmlFor='identifier' label={mode === 'staff' ? 'Email' : 'Executive username'}>
                  <Input
                    id='identifier'
                    type={mode === 'staff' ? 'email' : 'text'}
                    autoComplete='username'
                    value={identifier}
                    onChange={e => setIdentifier(e.target.value)}
                    required
                    placeholder=' '
                    className='h-14 border-0 px-3.5 text-base'
                  />
                </OutlinedField>

                <OutlinedField htmlFor='password' label={mustChange ? 'Current password' : 'Password'}>
                  <InputGroup className='h-14 border-0'>
                    <InputGroupInput
                      id='password'
                      type={visible ? 'text' : 'password'}
                      autoComplete='current-password'
                      value={password}
                      onChange={e => setPassword(e.target.value)}
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

                {mustChange && (
                  <OutlinedField htmlFor='newPassword' label='New password'>
                    <Input
                      id='newPassword'
                      type='password'
                      autoComplete='new-password'
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      required
                      minLength={8}
                      placeholder=' '
                      className='h-14 border-0 px-3.5 text-base'
                    />
                  </OutlinedField>
                )}

                {needsCode && (
                  <OutlinedField htmlFor='code' label='Authenticator code'>
                    <Input
                      id='code'
                      inputMode='numeric'
                      pattern='[0-9]{6}'
                      maxLength={6}
                      value={code}
                      onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                      autoFocus
                      placeholder=' '
                      className='h-14 border-0 px-3.5 text-base'
                    />
                  </OutlinedField>
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
