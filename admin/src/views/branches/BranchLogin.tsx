'use client'

import { useState } from 'react'

import { Loader2Icon } from 'lucide-react'

import { toast } from 'sonner'

import Logo from '@/components/shared/Logo'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { siteConfig } from '@/configs/site'
import { errorMessage, request } from '@/lib/api/client'
import { check, cleanErrors } from '@/lib/validate'

/**
 * Branch sign-in (/branch/login). Signs in through the gateway proxy, then hands the token to
 * `/api/branch/session`, which keeps it in the branch's own httpOnly cookie (as the staff login does).
 */
const BranchLogin = () => {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Live field checks: a field's message shows once it has been left (blur) or a submit was tried.
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [tried, setTried] = useState(false)
  const fieldErrors = cleanErrors({ username: check.required(username, 'Username'), password: check.required(password, 'Password') })
  const shown = (key: string) => (tried || touched[key] ? fieldErrors[key] : undefined)
  const leave = (key: string) => () => setTouched(t => ({ ...t, [key]: true }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setTried(true)
    if (Object.keys(fieldErrors).length) return
    setBusy(true)

    try {
      const { data } = await request<{ token: string }>('admin/branches/portal/login', { method: 'POST', body: { username: username.trim(), password } })

      await request('/api/branch/session', { raw: true, method: 'POST', body: { token: data.token } })

      // A full load, so nothing from the signed-out page stays in the query cache.
      location.assign('/branch')
    } catch (err) {
      setError(errorMessage(err))
      toast.error(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <div className='flex min-h-screen w-full items-center justify-center px-4 py-10'>
      <Card className='w-full max-w-[440px] gap-6 py-8 sm:px-4'>
        <CardHeader className='items-center gap-4 text-center'>
          <Logo className='justify-center gap-3 [&>*:first-child]:size-10' />
          <div>
            <CardTitle className='text-heading mb-1 text-3xl font-normal'>Branch sign in</CardTitle>
            <CardDescription>Branch panel of {siteConfig.name}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} noValidate>
            <FieldGroup className='gap-4'>
              <Field className='gap-2' data-invalid={!!shown('username')}>
                <FieldLabel htmlFor='branch-username'>Username</FieldLabel>
                <Input id='branch-username' autoComplete='username' value={username} onChange={e => setUsername(e.target.value)} onBlur={leave('username')} aria-invalid={!!shown('username')} required />
                {shown('username') && <FieldError>{shown('username')}</FieldError>}
              </Field>
              <Field className='gap-2' data-invalid={!!shown('password')}>
                <FieldLabel htmlFor='branch-password'>Password</FieldLabel>
                <Input id='branch-password' type='password' autoComplete='current-password' value={password} onChange={e => setPassword(e.target.value)} onBlur={leave('password')} aria-invalid={!!shown('password')} required />
                {shown('password') && <FieldError>{shown('password')}</FieldError>}
              </Field>
              {error && (
                <Alert variant='destructive'>
                  <AlertTitle>Sign-in failed</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button className='mt-2 h-11' type='submit' disabled={busy}>
                {busy && <Loader2Icon className='animate-spin' />}
                Sign in
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

export default BranchLogin
