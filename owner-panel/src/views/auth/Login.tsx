'use client'

import { useEffect, useState } from 'react'

import { useRouter, useSearchParams } from 'next/navigation'

import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import Logo from '@/components/shared/Logo'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Toaster } from '@/components/ui/sonner'
import { siteConfig } from '@/configs/site'
import { ApiError, errorMessage, request } from '@/lib/api/client'
import AuthBackgroundShape from '@/assets/svg/auth-background-shape'
import { safeNext } from '@/lib/safeNext'

const Login = () => {
  const router = useRouter()
  const params = useSearchParams()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)

  const userProblem = !username.trim() ? 'Enter the username' : null
  const passProblem = !password ? 'Enter the password' : null

  // Back here after Sign out, or sent here by an ended session: say so once.
  useEffect(() => {
    if (params.get('signedOut') === '1') toast.success('Signed out', { id: 'signed-out' })
    if (params.get('expired') === '1') toast.warning('Your session has ended — sign in again', { id: 'session-expired' })
  }, [params])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (userProblem || passProblem) return
    setBusy(true)
    setError(null)

    try {
      await request('/api/auth/login', { method: 'POST', body: { username: username.trim(), password } })
      toast.success('Signed in')

      // Only a path on this site — never another origin from a crafted `?next=`.
      router.replace(safeNext(params.get('next')))
      router.refresh()
    } catch (err) {
      const message = errorMessage(err)

      setError(message)
      toast.error(err instanceof ApiError && err.code === 'TOO_MANY_ATTEMPTS' ? 'Sign-in locked for now' : 'Sign-in failed', { description: message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='relative flex min-h-screen items-center justify-center overflow-x-hidden px-4 py-10'>
      <div className='absolute'>
        <AuthBackgroundShape />
      </div>
      <Card className='z-1 w-full gap-6 py-6 sm:max-w-sm'>
        <CardHeader className='gap-4 px-6'>
          <Logo className='gap-3' />
          <div>
            <CardTitle className='text-2xl font-semibold'>{siteConfig.name}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className='px-6'>
          <form onSubmit={submit} noValidate>
            <FieldGroup className='gap-4'>
              <Field className='gap-2'>
                <FieldLabel htmlFor='user'>Username</FieldLabel>
                <Input
                  id='user'
                  autoComplete='username'
                  autoFocus
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  aria-invalid={touched && !!userProblem}
                  required
                />
                {touched && userProblem && <p className='text-destructive text-xs'>{userProblem}</p>}
              </Field>
              <Field className='gap-2'>
                <FieldLabel htmlFor='pw'>Password</FieldLabel>
                <Input
                  id='pw'
                  type='password'
                  autoComplete='current-password'
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  aria-invalid={touched && !!passProblem}
                  required
                />
                {touched && passProblem && <p className='text-destructive text-xs'>{passProblem}</p>}
              </Field>
              {error && (
                <Alert variant='destructive'>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button type='submit' disabled={busy}>
                {busy && <Loader2Icon className='animate-spin' />} {busy ? 'Signing in…' : 'Sign in'}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
      <Toaster />
    </div>
  )
}

export default Login
