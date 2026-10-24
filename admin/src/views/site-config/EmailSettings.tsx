'use client'

import { useState } from 'react'

import { Loader2Icon } from 'lucide-react'

import { FormErrorsProvider, TextField, useFormErrors } from '@/components/shared/FormField'
import ErrorState from '@/components/shared/ErrorState'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useSession } from '@/contexts/SessionContext'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { check } from '@/lib/validate'

type Email = { sendFrom?: string | null; alertsTo?: string | null; hasAppPassword?: boolean; [k: string]: unknown }

const EmailSettings = () => {
  const { can } = useSession()
  const q = useApi<Email>('admin/site-config/email')
  const [form, setForm] = useState({ sendFrom: '', alertsTo: '', appPassword: '' })
  const [testTo, setTestTo] = useState('')

  // A fresh load refills the form (adjusting state during render, not in an effect).
  const [loaded, setLoaded] = useState<Email | undefined>(undefined)

  if (q.data && q.data !== loaded) {
    setLoaded(q.data)
    setForm(f => ({ ...f, sendFrom: q.data.sendFrom ?? '', alertsTo: q.data.alertsTo ?? '' }))
  }

  const f = useFormErrors()
  const t = useFormErrors()

  const patchOf = () => {
    const patch: Record<string, string> = {}

    if (form.sendFrom !== (q.data?.sendFrom ?? '')) patch.sendFrom = form.sendFrom.trim()
    if (form.alertsTo !== (q.data?.alertsTo ?? '')) patch.alertsTo = form.alertsTo.trim()
    if (form.appPassword) patch.appPassword = form.appPassword

    return patch
  }

  const save = useApiMutation({
    fn: () => api.put('admin/site-config/email', patchOf()),
    invalidate: [['api', 'admin/site-config/email']],
    success: 'Email settings saved',
    onSuccess: () => setForm(f => ({ ...f, appPassword: '' }))
  })

  const test = useApiMutation({
    fn: () => api.post('admin/site-config/email/test', testTo.trim() ? { to: testTo.trim() } : {}),
    success: 'Test email sent (check MAIL_DRY_RUN / SMTP in the backend .env if nothing arrives)'
  })

  return (
    <div>
      <PageHeader title='Email (SMTP sender)' description='The address the platform sends from and where operator alerts go. The SMTP host itself is backend configuration.' />
      {q.error && <ErrorState error={q.error} />}
      <div className='grid gap-6 lg:grid-cols-2'>
        <Card className='shadow-none'>
          <CardHeader>
            <CardTitle className='text-base'>Sender</CardTitle>
            <CardDescription>The app password is write-only; the platform never returns it.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className='grid gap-4'
              onSubmit={e => {
                e.preventDefault()

                const ok = f.passes(
                  Object.keys(patchOf()).length
                    ? {
                        sendFrom: check.email(form.sendFrom, 'Send from', true),
                        alertsTo: check.email(form.alertsTo, 'Alerts to', true),
                        appPassword: check.length(form.appPassword, 'App password', { max: 200 })
                      }
                    : 'Nothing changed — edit a field first'
                )

                if (ok) save.mutate(undefined, { onError: f.fromServer })
              }}
            >
              <FormErrorsProvider errors={f.errors} onClear={f.clear}>
              <TextField id='sendFrom' label='Send from' type='email' value={form.sendFrom} onChange={e => setForm({ ...form, sendFrom: e.target.value })} />
              <TextField id='alertsTo' label='Alerts to' type='email' hint='Payment webhooks and operator notices' value={form.alertsTo} onChange={e => setForm({ ...form, alertsTo: e.target.value })} />
              <TextField id='appPassword' label='App password' type='password' placeholder={q.data?.hasAppPassword ? '•••••••• (set)' : 'not set'} value={form.appPassword} onChange={e => setForm({ ...form, appPassword: e.target.value })} />
              </FormErrorsProvider>
              <Button type='submit' disabled={save.isPending || !can('config:write')} className='justify-self-start'>
                {save.isPending && <Loader2Icon className='animate-spin' />}
                Save
              </Button>
            </form>
          </CardContent>
        </Card>
        <Card className='shadow-none'>
          <CardHeader>
            <CardTitle className='text-base'>Send a test</CardTitle>
          </CardHeader>
          <CardContent className='grid gap-4'>
            <TextField id='testTo' label='To (optional)' type='email' hint='Defaults to the alerts address' error={t.errors.to} value={testTo} onChange={e => { t.reset(); setTestTo(e.target.value) }} />
            <Button
              variant='outline'
              onClick={() => t.passes({ to: check.email(testTo, 'To', true) }) && test.mutate(undefined, { onError: t.fromServer })}
              disabled={test.isPending || !can('config:write')}
              className='justify-self-start'
            >
              {test.isPending && <Loader2Icon className='animate-spin' />}
              Send test email
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default EmailSettings
