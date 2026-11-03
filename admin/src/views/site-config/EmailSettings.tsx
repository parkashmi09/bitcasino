'use client'

import { useState } from 'react'

import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { FormErrorsProvider, TextField, useFormErrors } from '@/components/shared/FormField'
import ErrorState from '@/components/shared/ErrorState'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useSession } from '@/contexts/SessionContext'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { check } from '@/lib/validate'

/** `GET admin/site-config/email` — the app password itself is never sent back, only whether one is saved. */
type EmailSettings = { sendFrom: string; alertsTo: string; hasAppPassword: boolean }

type TestResult = { sent: boolean; to: string; error: string | null }

const PATH = 'admin/site-config/email'

/**
 * The editable form, keyed by the loaded settings: a fresh load remounts it
 * with the new values, so no effect copies server data into state.
 */
const EmailForm = ({ initial }: { initial: EmailSettings | undefined }) => {
  const { can } = useSession()
  const writable = can('config:write')
  const [form, setForm] = useState({ sendFrom: initial?.sendFrom ?? '', alertsTo: initial?.alertsTo ?? '', appPassword: '' })
  const f = useFormErrors()

  /** Changed fields only; the app password only when typed, so saving without it keeps the stored one. */
  const patchOf = () => {
    const patch: Record<string, string> = {}

    if (form.sendFrom.trim() !== (initial?.sendFrom ?? '')) patch.sendFrom = form.sendFrom.trim()
    if (form.alertsTo.trim() !== (initial?.alertsTo ?? '')) patch.alertsTo = form.alertsTo.trim()
    if (form.appPassword.trim()) patch.appPassword = form.appPassword.trim()

    return patch
  }

  const save = useApiMutation({
    fn: () => api.put<EmailSettings>(PATH, patchOf()),
    invalidate: [['api', PATH]],
    success: 'Email settings saved'
  })

  const test = useApiMutation({
    fn: () => api.post<TestResult>(`${PATH}/test`),
    onSuccess: r => void (r.sent ? toast.success(`Test email sent to ${r.to}`) : toast.error(`Not sent: ${r.error ?? 'unknown error'}`))
  })

  return (
    <form
      className='grid gap-4'
      onSubmit={e => {
        e.preventDefault()

        const ok = f.passes({
          sendFrom: check.email(form.sendFrom, 'Sender Gmail address', true),
          alertsTo: check.email(form.alertsTo, 'Notification email', true)
        })

        if (!ok) return
        if (!Object.keys(patchOf()).length) return void toast.info('Nothing changed')
        save.mutate(undefined, {
          onError: f.fromServer,
          onSuccess: () => setForm(s => ({ ...s, appPassword: '' }))
        })
      }}
    >
      <FormErrorsProvider errors={f.errors} onClear={f.clear}>
        <TextField
          id='sendFrom'
          type='email'
          label='Sender Gmail address'
          hint='Player emails (password reset, email verification) are sent from this Gmail account.'
          value={form.sendFrom}
          onChange={e => setForm({ ...form, sendFrom: e.target.value })}
          disabled={!writable}
        />
        <TextField
          id='appPassword'
          type='password'
          autoComplete='new-password'
          label='Gmail app password'
          hint={
            initial?.hasAppPassword
              ? 'An app password is saved. Leave blank to keep it; type a new one to replace it.'
              : 'Google account → Security → App passwords. Not your Gmail login password.'
          }
          value={form.appPassword}
          onChange={e => setForm({ ...form, appPassword: e.target.value })}
          disabled={!writable}
        />
        <TextField
          id='alertsTo'
          type='email'
          label='Notification email'
          hint='Deposit and withdrawal alerts arrive here, and the test email below goes here.'
          value={form.alertsTo}
          onChange={e => setForm({ ...form, alertsTo: e.target.value })}
          disabled={!writable}
        />
      </FormErrorsProvider>
      <div className='flex flex-wrap gap-2'>
        <Button type='submit' disabled={save.isPending || !writable || !initial}>
          {save.isPending && <Loader2Icon className='animate-spin' />}
          Save
        </Button>
        <Button
          type='button'
          variant='outline'
          disabled={test.isPending || !writable || !initial?.alertsTo}
          onClick={() => test.mutate()}
        >
          {test.isPending && <Loader2Icon className='animate-spin' />}
          Send test email
        </Button>
      </div>
    </form>
  )
}

/** Site config → Email: the mailbox the site sends player and staff emails from. */
const EmailSettingsPage = () => {
  const q = useApi<EmailSettings>(PATH)

  return (
    <div>
      <PageHeader
        title='Email'
        description="The Gmail account the site sends player emails from (password reset, email verification) and where staff alerts go. The server's own SMTP settings, when complete, take precedence."
      />
      {q.error && <ErrorState error={q.error} />}
      <Card className='max-w-xl shadow-none'>
        <CardHeader>
          <CardTitle className='text-base'>Sender</CardTitle>
          <CardDescription>
            {q.data?.hasAppPassword && q.data.sendFrom ? `Sending from ${q.data.sendFrom}.` : 'No sender saved — player emails are not sent until one is.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EmailForm key={q.data ? JSON.stringify(q.data) : 'loading'} initial={q.data} />
        </CardContent>
      </Card>
    </div>
  )
}

export default EmailSettingsPage
