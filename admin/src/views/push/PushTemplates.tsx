'use client'

import { useState } from 'react'

import { Loader2Icon, RotateCcwIcon, SaveIcon } from 'lucide-react'

import Can from '@/components/shared/Can'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import ErrorState from '@/components/shared/ErrorState'
import { FormErrorsProvider, SwitchField, TextAreaField, TextField, useFormErrors } from '@/components/shared/FormField'
import PageHeader from '@/components/shared/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { check } from '@/lib/validate'
import { ImageInput, NotificationPreview, PushStatusCard, Warnings } from './PushParts'
import type { PushStatus, PushTemplate } from './types'

/** A sample event, so the preview reads like a real push. */
const SAMPLE: Record<string, string> = {
  amount: '500.00 INR',
  currency: 'INR',
  depositId: '1042',
  withdrawalId: '377',
  reference: 'TX-88231',
  reason: 'Payment proof unreadable',
  level: '5',
  card: 'Gold'
}

const fill = (s: string) => s.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (_, k: string) => SAMPLE[k] ?? '')

type Draft = { enabled: boolean; title: string; body: string; imageUrl: string; url: string }

const TemplateCard = ({ t, origin }: { t: PushTemplate; origin: string | null | undefined }) => {
  const initial: Draft = { enabled: t.enabled, title: t.title, body: t.body, imageUrl: t.imageUrl ?? '', url: t.url ?? '' }
  const [d, setD] = useState<Draft>(initial)
  const [warnings, setWarnings] = useState<string[]>([])
  const dirty = JSON.stringify(d) !== JSON.stringify(initial)

  const save = useApiMutation({
    fn: () =>
      api.put<PushTemplate>(`admin/push/templates/${t.kind}`, {
        enabled: d.enabled,
        title: d.title.trim(),
        body: d.body.trim(),
        imageUrl: d.imageUrl.trim() || undefined,
        url: d.url.trim() || undefined
      }),
    success: `${t.label}: saved`,
    invalidate: [['api', 'admin/push/templates']],
    onSuccess: r => setWarnings(r.warnings ?? [])
  })

  const reset = useApiMutation({
    fn: () => api.delete<PushTemplate>(`admin/push/templates/${t.kind}`),
    success: `${t.label}: back to the default copy`,
    invalidate: [['api', 'admin/push/templates']],
    onSuccess: r => setD({ enabled: r.enabled, title: r.title, body: r.body, imageUrl: r.imageUrl ?? '', url: r.url ?? '' })
  })

  const f = useFormErrors()

  // push.validators.js template body: title 1–120, body 1–500, image an http(s) URL, click URL https://… or a site path.
  const submit = () => {
    const url = d.url.trim()

    const ok = f.passes({
      title: check.required(d.title, 'Title') || check.length(d.title, 'Title', { max: 120 }),
      body: check.required(d.body, 'Message') || check.length(d.body, 'Message', { max: 500 }),
      imageUrl: check.url(d.imageUrl, 'Big image', true),
      url: url && !(/^https?:\/\//i.test(url) || url.startsWith('/') || url.startsWith('#')) ? 'Click URL must be https://… or a site path like /vip' : check.length(url, 'Click URL', { max: 2000 })
    })

    if (ok) save.mutate(undefined, { onError: f.fromServer })
  }

  const insert = (key: string) => setD(x => ({ ...x, body: `${x.body}${x.body.endsWith(' ') || !x.body ? '' : ' '}{${key}}` }))

  return (
    <Card className='shadow-none'>
      <CardHeader className='pb-3'>
        <CardTitle className='flex flex-wrap items-center gap-2 text-base'>
          {t.label}
          <Badge variant='outline' className='font-mono text-[11px]'>
            {t.kind}
          </Badge>
          {t.customised ? <Badge>customised</Badge> : <Badge variant='secondary'>default copy</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className='grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]'>
        <FormErrorsProvider errors={f.errors} onClear={f.clear}>
        <div className='grid content-start gap-4'>
          <SwitchField
            id={`tpl-${t.kind}-on`}
            label='Push this event'
            hint='Off: the bell row is still written, nothing is pushed.'
            checked={d.enabled}
            onChange={enabled => setD({ ...d, enabled })}
          />
          <TextField id={`tpl-${t.kind}-title`} name='title' label='Title' maxLength={120} value={d.title} onChange={e => setD({ ...d, title: e.target.value })} />
          <TextAreaField id={`tpl-${t.kind}-body`} name='body' label='Message' rows={2} maxLength={500} value={d.body} onChange={e => setD({ ...d, body: e.target.value })} />
          {t.placeholders.length > 0 && (
            <div className='flex flex-wrap items-center gap-1.5 text-xs'>
              <span className='text-muted-foreground'>Placeholders:</span>
              {t.placeholders.map(p => (
                <button key={p} type='button' onClick={() => insert(p)} className='bg-muted hover:bg-accent rounded px-1.5 py-0.5 font-mono'>
                  {`{${p}}`}
                </button>
              ))}
            </div>
          )}
          <ImageInput id={`tpl-${t.kind}-img`} label='Big image (optional)' value={d.imageUrl} error={f.errors.imageUrl} onChange={imageUrl => {
            f.clear('imageUrl')
            setD({ ...d, imageUrl })
          }} />
          <TextField id={`tpl-${t.kind}-url`} name='url' label='Click URL' placeholder={t.defaults.url} value={d.url} onChange={e => setD({ ...d, url: e.target.value })} />
          <Warnings items={warnings} title='Saved with warnings' />
          <Can permission='config:write'>
            <div className='flex flex-wrap gap-2'>
              <Button disabled={!dirty || save.isPending} onClick={submit}>
                {save.isPending ? <Loader2Icon className='animate-spin' /> : <SaveIcon />} Save
              </Button>
              {t.customised && (
                <ConfirmDialog
                  trigger={
                    <Button variant='outline'>
                      <RotateCcwIcon /> Reset to default
                    </Button>
                  }
                  title={`Reset “${t.label}”?`}
                  description={`Back to: “${t.defaults.title}” — “${t.defaults.body}”.`}
                  confirmLabel='Reset'
                  onConfirm={() => reset.mutateAsync()}
                />
              )}
            </div>
          </Can>
        </div>
        </FormErrorsProvider>
        <NotificationPreview title={fill(d.title)} body={fill(d.body)} imageUrl={d.imageUrl} url={d.url} origin={origin} />
      </CardContent>
    </Card>
  )
}

const PushTemplates = () => {
  const { data, isLoading, error, dataUpdatedAt } = useApi<PushTemplate[]>('admin/push/templates')
  const status = useApi<PushStatus>('admin/push/status')
  const groups = [...new Set((data ?? []).map(t => t.group))]

  return (
    <div>
      <PageHeader
        title='Push templates'
        description='The words of the automatic pushes a player gets when something happens to their account. The same copy is used for the site bell. Placeholders are filled from the event; the preview uses sample values.'
      />
      <PushStatusCard />
      {isLoading && <Card className='h-64 animate-pulse shadow-none' />}
      {error && <ErrorState error={error} />}
      <div className='grid gap-8'>
        {groups.map(g => (
          <section key={g} className='grid gap-4'>
            <div>
              <h2 className='text-base font-semibold'>{g}</h2>
              <CardDescription>{data!.filter(t => t.group === g).length} event(s)</CardDescription>
            </div>
            {data!
              .filter(t => t.group === g)
              .map(t => (
                <TemplateCard key={`${t.kind}-${dataUpdatedAt}`} t={t} origin={status.data?.publicOrigin} />
              ))}
          </section>
        ))}
      </div>
    </div>
  )
}

export default PushTemplates
