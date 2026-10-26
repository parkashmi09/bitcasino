'use client'

import { useState } from 'react'

import { Loader2Icon } from 'lucide-react'

import Logo from '@/components/shared/Logo'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { siteConfig } from '@/configs/site'
import { errorMessage, request } from '@/lib/api/client'

/**
 * Branch sign-in (/branch/login). Signs in through the gateway proxy, then hands the token to
 * `/api/branch/session`, which keeps it in the branch's own httpOnly cookie (as the staff login does).
 */
const BranchLogin = () => {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!username.trim() || !password) return setError('Enter your branch username and password.')
    setBusy(true)

    try {
      const { data } = await request<{ token: string }>('admin/branches/portal/login', { method: 'POST', body: { username: username.trim(), password } })

      await request('/api/branch/session', { raw: true, method: 'POST', body: { token: data.token } })

      // A full load, so nothing from the signed-out page stays in the query cache.
      location.assign('/branch')
    } catch (err) {
      setError(errorMessage(err))
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
          <form onSubmit={submit}>
            <FieldGroup className='gap-4'>
              <Field className='gap-2'>
                <FieldLabel htmlFor='branch-username'>Username</FieldLabel>
                <Input id='branch-username' autoComplete='username' value={username} onChange={e => setUsername(e.target.value)} required />
              </Field>
              <Field className='gap-2'>
                <FieldLabel htmlFor='branch-password'>Password</FieldLabel>
                <Input id='branch-password' type='password' autoComplete='current-password' value={password} onChange={e => setPassword(e.target.value)} required />
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
