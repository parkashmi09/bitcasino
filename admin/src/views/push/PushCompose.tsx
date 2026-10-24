'use client'

import { useEffect, useMemo, useState } from 'react'

import { useRouter, useSearchParams } from 'next/navigation'

import { CalendarClockIcon, EyeIcon, FlaskConicalIcon, Loader2Icon, PlusIcon, SaveIcon, SendIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'

import Can from '@/components/shared/Can'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import { DateTimeField, FormErrorsProvider, SelectField, SwitchField, TextAreaField, TextField, useFormErrors } from '@/components/shared/FormField'
import JsonView from '@/components/shared/JsonView'
import PageHeader from '@/components/shared/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api, errorMessage } from '@/lib/api/client'
import { check, firstError, type FieldErrors } from '@/lib/validate'
import { ImageInput, NotificationPreview, PushStatusCard, Warnings } from './PushParts'
import {
  KNOWN_TAGS,
  TAG_RELATIONS,
  type Audience,
  type Campaign,
  type PreviewResult,
  type PushStatus,
  type TagFilter,
  type TestResult
} from './types'

type FormButton = { id: string; text: string; url: string }

type Form = {
  name: string
  title: string
  body: string
  imageUrl: string
  iconUrl: string
  url: string
  buttons: FormButton[]
  priority: 'normal' | 'high'
  ttl: string
  topic: string
  audienceKind: Audience['kind']
  userIds: string
  segments: string
  filters: TagFilter[]
  match: 'all' | 'any'
  inbox: boolean
  sendAt: string
}

const EMPTY: Form = {
  name: '',
  title: '',
  body: '',
  imageUrl: '',
  iconUrl: '',
  url: '',
  buttons: [],
  priority: 'normal',
  ttl: '',
  topic: '',
  audienceKind: 'all',
  userIds: '',
  segments: '',
  filters: [{ tag: 'vip_level', relation: '>', value: '0' }],
  match: 'all',
  inbox: true,
  sendAt: ''
}

const pad = (n: number) => String(n).padStart(2, '0')

const toLocal = (iso: string) => {
  const d = new Date(iso)

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const fromCampaign = (c: Campaign): Form => ({
  ...EMPTY,
  name: c.name ?? '',
  title: c.title,
  body: c.body,
  imageUrl: c.imageUrl ?? '',
  iconUrl: c.iconUrl ?? '',
  url: c.url ?? '',
  buttons: (c.buttons ?? []).map(b => ({ id: b.id, text: b.text, url: b.url ?? '' })),
  priority: c.priority,
  ttl: c.ttlSeconds == null ? '' : String(c.ttlSeconds),
  topic: c.topic ?? '',
  audienceKind: c.audience.kind,
  userIds: c.audience.kind === 'players' ? c.audience.userIds.join(', ') : '',
  segments: c.audience.kind === 'segment' ? c.audience.segments.join(', ') : '',
  filters: c.audience.kind === 'filters' ? c.audience.filters : EMPTY.filters,
  match: c.audience.kind === 'filters' ? c.audience.match : 'all',
  inbox: c.inbox,
  sendAt: c.sendAt && c.status === 'scheduled' ? toLocal(c.sendAt) : ''
})

const list = (s: string) =>
  s
    .split(/[\s,]+/)
    .map(x => x.trim())
    .filter(Boolean)

const audienceOf = (f: Form): Audience => {
  switch (f.audienceKind) {
    case 'players':
      return { kind: 'players', userIds: list(f.userIds).map(Number).filter(n => Number.isInteger(n) && n > 0) }
    case 'segment':
      return { kind: 'segment', segments: f.segments.split(',').map(s => s.trim()).filter(Boolean) }
    case 'filters':
      return {
        kind: 'filters',
        match: f.match,
        filters: f.filters.map(x => ({
          tag: x.tag.trim(),
          relation: x.relation,
          ...(['exists', 'not_exists'].includes(x.relation) ? {} : { value: String(x.value ?? '') })
        }))
      }
    default:
      return { kind: 'all' }
  }
}

/** What a push says — the keys `/push/test` accepts (validators are strict, so blanks are left out). */
const contentOf = (f: Form) => ({
  title: f.title.trim(),
  body: f.body.trim(),
  imageUrl: f.imageUrl.trim() || undefined,
  iconUrl: f.iconUrl.trim() || undefined,
  url: f.url.trim() || undefined,
  buttons: f.buttons.map(b => ({ id: b.id.trim(), text: b.text.trim(), url: b.url.trim() || undefined })),
  priority: f.priority,
  ttlSeconds: f.ttl.trim() ? Number(f.ttl) : undefined,
  topic: f.topic.trim() || undefined
})

const campaignOf = (f: Form, withSchedule: boolean) => ({
  ...contentOf(f),
  name: f.name.trim() || undefined,
  audience: audienceOf(f),
  inbox: f.inbox,
  sendAt: withSchedule && f.sendAt ? new Date(f.sendAt).toISOString() : undefined
})

const isClickUrl = (u: string) => /^https?:\/\//i.test(u) || u.startsWith('/') || u.startsWith('#')

/** push.validators.js `campaignBody` / `content`, checked before anything is sent. Keys are the server's field names. */
const problemsOf = (f: Form, withSchedule: boolean): FieldErrors => {
  const url = f.url.trim()
  const ids = list(f.userIds)
  const segs = f.segments.split(',').map(x => x.trim()).filter(Boolean)
  const badButton = f.buttons.findIndex(b => !/^[a-zA-Z0-9_-]{1,32}$/.test(b.id.trim()) || !b.text.trim() || b.text.trim().length > 40 || (b.url.trim() && !isClickUrl(b.url.trim())))
  const badFilter = f.filters.findIndex(x => !/^[a-zA-Z0-9_]{1,32}$/.test(x.tag.trim()) || String(x.value ?? '').length > 100)
  const sendAt = f.sendAt ? new Date(f.sendAt).getTime() : NaN

  return {
    name: check.length(f.name, 'Internal name', { max: 120 }),
    title: check.required(f.title, 'Title') || check.length(f.title, 'Title', { max: 120 }),
    body: check.required(f.body, 'Message') || check.length(f.body, 'Message', { max: 500 }),
    imageUrl: check.url(f.imageUrl, 'Big image', true),
    iconUrl: check.url(f.iconUrl, 'Icon', true),
    url: url && !isClickUrl(url) ? 'Click URL must be https://… or a site path like /vip' : check.length(url, 'Click URL', { max: 2000 }),
    buttons:
      badButton >= 0
        ? `Button ${badButton + 1}: id is letters, digits, _ or - (max 32), text is required (max 40), URL is https://… or a site path`
        : undefined,
    ttlSeconds: check.number(f.ttl, 'Time to live', { integer: true, min: 0, max: 2419200, optional: true }),
    topic: f.topic.trim() && !/^[a-zA-Z0-9_-]{1,64}$/.test(f.topic.trim()) ? 'Topic: letters, digits, _ or - (max 64)' : undefined,
    'audience.userIds':
      f.audienceKind !== 'players'
        ? undefined
        : !ids.length
          ? 'Enter at least one player id'
          : ids.some(x => !/^\d+$/.test(x) || Number(x) <= 0)
            ? 'Player ids must be positive whole numbers'
            : ids.length > 10000
              ? 'At most 10,000 player ids'
              : undefined,
    'audience.segments': f.audienceKind !== 'segment' ? undefined : !segs.length ? 'Enter a segment name' : segs.length > 5 ? 'At most 5 segments' : segs.some(x => x.length > 100) ? 'A segment name is at most 100 characters' : undefined,
    'audience.filters': f.audienceKind !== 'filters' ? undefined : badFilter >= 0 ? `Filter ${badFilter + 1}: tag is letters, digits or _ (max 32), value at most 100 characters` : undefined,
    sendAt: !withSchedule ? undefined : !f.sendAt ? 'Pick a schedule time first' : Number.isNaN(sendAt) ? 'Pick a valid schedule time' : sendAt <= Date.now() ? 'The schedule time must be in the future' : undefined
  }
}

const PushCompose = () => {
  const router = useRouter()
  const params = useSearchParams()
  const editId = params.get('id')
  const existing = useApi<Campaign>(editId ? `admin/push/campaigns/${editId}` : null)
  const status = useApi<PushStatus>('admin/push/status')

  const [form, setForm] = useState<Form>(EMPTY)
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [saveWarnings, setSaveWarnings] = useState<string[]>([])
  const [testUser, setTestUser] = useState('')
  const [testResult, setTestResult] = useState<TestResult | null>(null)

  // Load a campaign being edited once (the form is the user's after that).
  useEffect(() => {
    if (existing.data && editId && loadedId !== editId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm(fromCampaign(existing.data))
      setLoadedId(editId)
    }
  }, [existing.data, editId, loadedId])

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm(f => ({ ...f, [key]: value }))
    setPreview(null)
  }

  const editable = !existing.data || ['draft', 'scheduled', 'failed'].includes(existing.data.status)
  const audience = useMemo(() => audienceOf(form), [form])

  const f = useFormErrors()
  const problem = firstError(problemsOf(form, false))
  const ready = !problem

  /** Validate (inline + toast), then run; a 422 lands on the fields. */
  const run = (m: { mutate: (v: undefined, o: { onError: (e: unknown) => void }) => void }, withSchedule = false) => {
    if (f.passes(problemsOf(form, withSchedule))) m.mutate(undefined, { onError: f.fromServer })
  }

  const testUserError = testUser ? check.id(testUser, 'Test player id') : undefined
  const pushOnly = form.audienceKind === 'segment' || form.audienceKind === 'filters'

  const doPreview = useApiMutation({
    fn: () => api.post<PreviewResult>('admin/push/preview', { ...campaignOf(form, false), probe: true }),
    onSuccess: r => setPreview(r)
  })

  /** Create or update; returns the campaign. */
  const save = async (withSchedule: boolean) => {
    const body = campaignOf(form, withSchedule)
    const id = loadedId ?? editId
    const c = id ? await api.put<Campaign>(`admin/push/campaigns/${id}`, body) : await api.post<Campaign>('admin/push/campaigns', body)

    setSaveWarnings(c.warnings ?? [])

    if (!id) {
      setLoadedId(String(c.id))
      router.replace(`/push/compose?id=${c.id}`)
    }

    return c
  }

  const saveDraft = useApiMutation({ fn: () => save(false), success: 'Draft saved', invalidate: [['paged', 'admin/push/campaigns']] })

  const schedule = useApiMutation({
    fn: () => save(true),
    success: c => `Scheduled for ${new Date(c.sendAt ?? '').toLocaleString()}`,
    invalidate: [['paged', 'admin/push/campaigns']],
    onSuccess: () => router.push('/push/campaigns')
  })

  const sendNow = useApiMutation({
    fn: async () => {
      const c = await save(false)

      return api.post<Campaign>(`admin/push/campaigns/${c.id}/send`)
    },
    success: c =>
      c.status === 'sent'
        ? `Sent — ${c.accepted} accepted by OneSignal, ${c.inboxRows} inbox row(s)`
        : `Campaign ${c.status}${c.error ? `: ${c.error}` : ''}`,
    invalidate: [['paged', 'admin/push/campaigns']],
    onSuccess: () => router.push('/push/campaigns')
  })

  const test = useApiMutation({
    fn: () => api.post<TestResult>('admin/push/test', { userId: Number(testUser), ...contentOf(form) }),
    onSuccess: r => {
      setTestResult(r)
      if (r.accepted) toast.success('Test push accepted by OneSignal')
      else toast.warning(r.hint ?? 'OneSignal accepted nothing')
    }
  })

  const setButton = (i: number, patch: Partial<FormButton>) => set('buttons', form.buttons.map((b, j) => (j === i ? { ...b, ...patch } : b)))
  const setFilter = (i: number, patch: Partial<TagFilter>) => set('filters', form.filters.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  return (
    <div>
      <PageHeader
        title={editId ? `Edit campaign #${editId}` : 'Compose push'}
        description='Web push through OneSignal. Players who allowed notifications on the site get it on their device; the targeted players also get it in the site bell.'
        actions={
          editId ? (
            <Button variant='outline' onClick={() => router.push('/push/compose')}>
              <PlusIcon /> New
            </Button>
          ) : null
        }
      />
      <PushStatusCard />
      {existing.data && !editable && (
        <Warnings title='Read only' items={[`This campaign is ${existing.data.status}; only drafts, scheduled and failed campaigns can be edited.`]} />
      )}
      <FormErrorsProvider errors={f.errors} onClear={f.clear}>
      <div className='grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]'>
        <div className='grid content-start gap-6'>
          <Card className='shadow-none'>
            <CardHeader>
              <CardTitle className='text-base'>Message</CardTitle>
            </CardHeader>
            <CardContent className='grid gap-4'>
              <TextField id='p-name' name='name' label='Internal name' hint='Only staff see this.' maxLength={120} value={form.name} onChange={e => set('name', e.target.value)} />
              <TextField id='p-title' name='title' label='Title' required maxLength={120} value={form.title} onChange={e => set('title', e.target.value)} hint={`${form.title.length}/120 — keep it under ~50 to avoid truncation.`} />
              <TextAreaField id='p-body' name='body' label='Message' required rows={3} maxLength={500} value={form.body} onChange={e => set('body', e.target.value)} hint={`${form.body.length}/500`} />
              <ImageInput id='p-image' label='Big image' value={form.imageUrl} error={f.errors.imageUrl} onChange={v => { f.clear('imageUrl'); set('imageUrl', v) }} />
              <ImageInput
                id='p-icon'
                label='Icon (optional)'
                value={form.iconUrl}
                error={f.errors.iconUrl}
                onChange={v => {
                  f.clear('iconUrl')
                  set('iconUrl', v)
                }}
                hint='Square, 256×256 recommended. Empty = the default icon from Prompt & settings or the OneSignal dashboard.'
              />
              <TextField id='p-url' name='url' label='Click URL' placeholder='/promotions or https://…' value={form.url} onChange={e => set('url', e.target.value)} hint='A site path opens inside the site; the public origin is added for you.' />
            </CardContent>
          </Card>

          <Card className='shadow-none'>
            <CardHeader>
              <CardTitle className='text-base'>Buttons</CardTitle>
              <CardDescription>Up to two action buttons (Chrome desktop and Android). Without a URL a button opens the click URL.</CardDescription>
            </CardHeader>
            <CardContent className='grid gap-3'>
              {form.buttons.map((b, i) => (
                <div key={i} className='grid gap-2 sm:grid-cols-[120px_1fr_1fr_auto]'>
                  <Input placeholder='id' value={b.id} onChange={e => setButton(i, { id: e.target.value })} aria-label='Button id' />
                  <Input placeholder='Text' maxLength={40} value={b.text} onChange={e => setButton(i, { text: e.target.value })} aria-label='Button text' />
                  <Input placeholder='/deposit or https://…' value={b.url} onChange={e => setButton(i, { url: e.target.value })} aria-label='Button URL' />
                  <Button variant='ghost' size='icon' aria-label='Remove button' onClick={() => set('buttons', form.buttons.filter((_, j) => j !== i))}>
                    <Trash2Icon />
                  </Button>
                </div>
              ))}
              {f.errors.buttons && (
                <p role='alert' className='text-destructive text-sm'>
                  {f.errors.buttons}
                </p>
              )}
              {form.buttons.length < 2 && (
                <Button
                  variant='outline'
                  className='justify-self-start'
                  onClick={() => set('buttons', [...form.buttons, { id: `btn${form.buttons.length + 1}`, text: '', url: '' }])}
                >
                  <PlusIcon /> Add button
                </Button>
              )}
            </CardContent>
          </Card>

          <Card className='shadow-none'>
            <CardHeader>
              <CardTitle className='text-base'>Audience</CardTitle>
              <CardDescription>
                Everyone and player lists are your own players and also get a bell (inbox) row. Segments and tag filters are matched by OneSignal (top-level operators only) and are push-only.
              </CardDescription>
            </CardHeader>
            <CardContent className='grid gap-4'>
              <Tabs value={form.audienceKind} onValueChange={v => set('audienceKind', v as Audience['kind'])}>
                <TabsList>
                  <TabsTrigger value='all'>Everyone</TabsTrigger>
                  <TabsTrigger value='players'>Player ids</TabsTrigger>
                  <TabsTrigger value='segment'>Segment</TabsTrigger>
                  <TabsTrigger value='filters'>Tag filter</TabsTrigger>
                </TabsList>
              </Tabs>
              {form.audienceKind === 'all' && (
                <p className='text-muted-foreground text-sm'>
                  Every player in your tree. For a top-level operator this is every subscriber of the app (OneSignal segment “{status.data?.allSegment ?? 'Total Subscriptions'}”).
                </p>
              )}
              {form.audienceKind === 'players' && (
                <TextAreaField
                  id='p-users'
                  name='audience.userIds'
                  label='Player ids'
                  rows={3}
                  placeholder='12, 15, 2041'
                  value={form.userIds}
                  onChange={e => set('userIds', e.target.value)}
                  hint={`${audience.kind === 'players' ? audience.userIds.length : 0} id(s). Ids outside your tree are skipped.`}
                />
              )}
              {form.audienceKind === 'segment' && (
                <TextField
                  id='p-seg'
                  name='audience.segments'
                  label='OneSignal segment name(s)'
                  placeholder='Active Subscriptions, VIP'
                  value={form.segments}
                  onChange={e => set('segments', e.target.value)}
                  hint='Exactly as named in the OneSignal dashboard, comma separated (max 5).'
                />
              )}
              {form.audienceKind === 'filters' && (
                <div className='grid gap-3'>
                  {form.filters.map((x, i) => (
                    <div key={i} className='grid gap-2 sm:grid-cols-[1fr_140px_1fr_auto]'>
                      <Input list='push-known-tags' placeholder='tag' value={x.tag} onChange={e => setFilter(i, { tag: e.target.value })} aria-label='Tag' />
                      <Select value={x.relation} onValueChange={v => v && setFilter(i, { relation: v })}>
                        <SelectTrigger className='w-full' aria-label='Relation'>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TAG_RELATIONS.map(r => (
                            <SelectItem key={r} value={r}>
                              {r}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        placeholder='value'
                        disabled={['exists', 'not_exists'].includes(x.relation)}
                        value={x.value ?? ''}
                        onChange={e => setFilter(i, { value: e.target.value })}
                        aria-label='Value'
                      />
                      <Button variant='ghost' size='icon' aria-label='Remove filter' disabled={form.filters.length === 1} onClick={() => set('filters', form.filters.filter((_, j) => j !== i))}>
                        <Trash2Icon />
                      </Button>
                    </div>
                  ))}
                  <datalist id='push-known-tags'>
                    {KNOWN_TAGS.map(t => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                  <div className='flex flex-wrap items-center gap-3'>
                    {form.filters.length < 10 && (
                      <Button variant='outline' onClick={() => set('filters', [...form.filters, { tag: '', relation: '=', value: '' }])}>
                        <PlusIcon /> Add filter
                      </Button>
                    )}
                    <SelectField
                      id='p-match'
                      label='Match'
                      value={form.match}
                      onChange={v => set('match', v as 'all' | 'any')}
                      options={[
                        { value: 'all', label: 'All filters (AND)' },
                        { value: 'any', label: 'Any filter (OR)' }
                      ]}
                    />
                  </div>
                  {f.errors['audience.filters'] && (
                    <p role='alert' className='text-destructive text-sm'>
                      {f.errors['audience.filters']}
                    </p>
                  )}
                  <p className='text-muted-foreground text-xs'>The site sets vip_level, language, currency and country on every subscriber.</p>
                </div>
              )}
              <SwitchField
                id='p-inbox'
                label='Also show in the site bell'
                hint={pushOnly ? 'Not available for segments and tag filters (the backend cannot know who OneSignal matched).' : 'Writes an inbox row (with the image) for every targeted player.'}
                checked={form.inbox && !pushOnly}
                disabled={pushOnly}
                onChange={v => set('inbox', v)}
              />
            </CardContent>
          </Card>

          <Card className='shadow-none'>
            <CardHeader>
              <CardTitle className='text-base'>Delivery</CardTitle>
            </CardHeader>
            <CardContent className='grid gap-4 sm:grid-cols-2'>
              <SelectField
                id='p-priority'
                label='Priority'
                value={form.priority}
                onChange={v => set('priority', v as 'normal' | 'high')}
                options={[
                  { value: 'normal', label: 'Normal' },
                  { value: 'high', label: 'High (wakes the device)' }
                ]}
              />
              <TextField id='p-ttl' name='ttlSeconds' label='Time to live (seconds)' inputMode='numeric' placeholder='default: 3 days' value={form.ttl} onChange={e => set('ttl', e.target.value.replace(/\D/g, ''))} hint='Dropped if the device is offline longer than this. Max 28 days.' />
              <TextField id='p-topic' name='topic' label='Replace topic' placeholder='e.g. daily-promo' value={form.topic} onChange={e => set('topic', e.target.value)} hint='A newer push with the same topic replaces the older one on the device.' />
              <DateTimeField id='p-sendat' label='Schedule (your local time)' error={f.errors.sendAt} value={form.sendAt} onChange={v => { f.clear('sendAt'); set('sendAt', v) }} hint='Leave empty to send now or save a draft.' />
            </CardContent>
          </Card>
        </div>

        <div className='grid content-start gap-6 xl:sticky xl:top-4'>
          <Card className='shadow-none'>
            <CardHeader>
              <CardTitle className='text-base'>Live preview</CardTitle>
            </CardHeader>
            <CardContent>
              <NotificationPreview
                title={form.title}
                body={form.body}
                imageUrl={form.imageUrl}
                iconUrl={form.iconUrl}
                url={form.url}
                buttons={contentOf(form).buttons}
                origin={status.data?.publicOrigin}
              />
            </CardContent>
          </Card>

          <Card className='shadow-none'>
            <CardContent className='grid gap-3 pt-6'>
              <Button variant='outline' disabled={doPreview.isPending} onClick={() => run(doPreview)}>
                {doPreview.isPending ? <Loader2Icon className='animate-spin' /> : <EyeIcon />} Preview payload &amp; audience
              </Button>
              <Can permission='config:write'>
                <div className='grid grid-cols-2 gap-2'>
                  <Button variant='outline' disabled={!editable || saveDraft.isPending} onClick={() => run(saveDraft)}>
                    {saveDraft.isPending ? <Loader2Icon className='animate-spin' /> : <SaveIcon />} Save draft
                  </Button>
                  <Button
                    variant='outline'
                    disabled={!editable || schedule.isPending}
                    onClick={() => run(schedule, true)}
                    title={form.sendAt ? undefined : 'Pick a schedule time first'}
                  >
                    {schedule.isPending ? <Loader2Icon className='animate-spin' /> : <CalendarClockIcon />} Schedule
                  </Button>
                </div>
                <ConfirmDialog
                  trigger={
                    <Button className='w-full' disabled={!ready || !editable}>
                      <SendIcon /> Send now
                    </Button>
                  }
                  title='Send this push now?'
                  description={`“${form.title}” to ${
                    audience.kind === 'all' ? 'everyone' : audience.kind === 'players' ? `${audience.userIds.length} player(s)` : audience.kind === 'segment' ? `segment ${audience.segments.join(', ')}` : 'the tag filter'
                  }. A push cannot be recalled once OneSignal accepts it.`}
                  confirmLabel='Send'
                  onConfirm={() => sendNow.mutateAsync()}
                />
                {problem && editable && <p className='text-muted-foreground text-xs'>Before sending: {problem}</p>}
                <div className='flex gap-2'>
                  <Input placeholder='Player id' inputMode='numeric' value={testUser} aria-invalid={testUserError ? true : undefined} onChange={e => setTestUser(e.target.value.replace(/\D/g, ''))} aria-label='Test player id' />
                  <Button
                    variant='secondary'
                    disabled={!testUser || test.isPending}
                    onClick={() => {
                      if (testUserError) return void toast.error(testUserError)
                      run(test)
                    }}
                  >
                    {test.isPending ? <Loader2Icon className='animate-spin' /> : <FlaskConicalIcon />} Test
                  </Button>
                </div>
                <p className='text-muted-foreground text-xs'>A test push goes to one player only, with no bell row. That player must have allowed notifications on the site while signed in.</p>
              </Can>
              {testResult && (
                <div className='text-sm'>
                  Test: <Badge variant='outline'>{testResult.accepted ? 'accepted' : 'not accepted'}</Badge>{' '}
                  {testResult.failures.length > 0 && <span className='text-muted-foreground text-xs'>{testResult.failures.join('; ')}</span>}
                </div>
              )}
              <Warnings items={saveWarnings} title='Saved with warnings' />
            </CardContent>
          </Card>

          {doPreview.error && <Warnings title='Preview failed' items={[errorMessage(doPreview.error)]} />}
          {preview && (
            <Card className='shadow-none'>
              <CardHeader>
                <CardTitle className='text-base'>What will be sent</CardTitle>
                <CardDescription>
                  {preview.audience.players != null ? `${preview.audience.players} player(s) in your tree` : 'Matched by OneSignal'}
                  {preview.audience.skipped ? ` · ${preview.audience.skipped} id(s) skipped (not in your tree)` : ''} · OneSignal target: {preview.audience.oneSignalTarget} ·{' '}
                  {preview.audience.inbox ? 'with bell rows' : 'push only'}
                </CardDescription>
              </CardHeader>
              <CardContent className='grid gap-3'>
                <Warnings items={preview.warnings} />
                <JsonView value={preview.payload} />
                <p className='text-muted-foreground text-xs'>The exact JSON posted to OneSignal; the API key is added server-side and never shown.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      </FormErrorsProvider>
    </div>
  )
}

export default PushCompose
