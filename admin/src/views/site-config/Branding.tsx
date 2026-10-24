'use client'

import { useRef, useState } from 'react'

import { LockIcon, RotateCcwIcon, UploadIcon } from 'lucide-react'

import ErrorState from '@/components/shared/ErrorState'
import { FormErrorsProvider, TextAreaField, TextField, useFormErrors } from '@/components/shared/FormField'
import PageHeader from '@/components/shared/PageHeader'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useLivePoll } from '@/lib/realtime-status'
import { useSession } from '@/contexts/SessionContext'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'

/** `GET /api/v1/admin/branding` — the owner panel's, with the Super Admin's newer logo / icon / metadata over it. */
type SiteBranding = {
  version: number
  branded: boolean
  siteName: string | null
  title: string | null
  titleTemplate: string | null
  description: string | null
  keywords: string[]
  ogTitle: string | null
  ogDescription: string | null
  themeColor: string | null
  logoUrl: string | null
  markUrl: string | null
  ogImageUrl: string | null
  managedBy: 'owner' | null

  /** Whose name and metadata players get: the Super Admin's (set here, after the owner's) or the platform's. */
  metaBy?: 'site' | 'platform'
}

/** The backend answers `/api/v1/admin/branding/asset/<hash>.<ext>`; this admin reaches the gateway through its own proxy. */
const src = (path: string | null) => (path ? api.url(path.replace(/^\/api\/v1\//, '')) : null)

const Row = ({ label, value }: { label: string; value: string | null | undefined }) => (
  <div className='grid gap-1 py-2 sm:grid-cols-[12rem_1fr]'>
    <dt className='text-muted-foreground text-sm'>{label}</dt>
    <dd className='text-sm break-words'>{value || <span className='text-muted-foreground'>— the site&apos;s own</span>}</dd>
  </div>
)

const Picture = ({ label, url, className, dark = true }: { label: string; url: string | null; className: string; dark?: boolean }) => (
  <div className='flex flex-col gap-1.5'>
    <span className='text-muted-foreground text-xs'>{label}</span>
    <div className='flex h-16 min-w-24 items-center justify-center rounded-md border px-3' style={{ background: dark ? '#232626' : '#FFFFFF' }}>
      {url ? (
         
        <img src={url} alt={label} className={className} />
      ) : (
        <span className='text-muted-foreground text-xs'>the UI&apos;s own</span>
      )}
    </div>
  </div>
)

/**
 * The Super Admin's upload / reset for the logo or the icon (`PUT|DELETE admin/branding/:slot`).
 * The newer of the Super Admin's and the owner's image is what players get.
 */
const SiteImage = ({ slot }: { slot: 'logo' | 'mark' }) => {
  const input = useRef<HTMLInputElement>(null)
  const name = slot === 'logo' ? 'Logo' : 'Icon'
  const invalidate = [['api', 'admin/branding']]

  const upload = useApiMutation({
    fn: (file: File) => {
      const fd = new FormData()

      fd.set('image', file)

      return api.upload(`admin/branding/${slot}`, fd, 'PUT')
    },
    invalidate,
    success: `${name} updated on the site`
  })

  const reset = useApiMutation({ fn: () => api.delete(`admin/branding/${slot}`), invalidate, success: `${name} reset to the platform's` })

  return (
    <div className='flex gap-2'>
      <input
        ref={input}
        type='file'
        accept='image/png,image/webp,image/svg+xml'
        className='hidden'
        onChange={e => {
          const file = e.target.files?.[0]

          e.target.value = ''
          if (file) upload.mutate(file)
        }}
      />
      <Button size='sm' variant='outline' disabled={upload.isPending} onClick={() => input.current?.click()}>
        <UploadIcon /> Change {name.toLowerCase()}
      </Button>
      <Button size='sm' variant='ghost' disabled={reset.isPending} onClick={() => reset.mutate()} title="Back to the platform's image">
        <RotateCcwIcon /> Reset
      </Button>
    </div>
  )
}

/**
 * The Super Admin's name and metadata (`PUT|DELETE admin/branding/meta`). Like the logo, the newer
 * of the Super Admin's and the owner's is what players get; Reset goes back to the platform's.
 */
const MetaForm = ({ b }: { b: SiteBranding }) => {
  const f = useFormErrors()

  const [form, setForm] = useState({
    siteName: b.siteName ?? '',
    title: b.title ?? '',
    titleTemplate: b.titleTemplate ?? '',
    description: b.description ?? '',
    keywords: b.keywords.join(', '),
    ogTitle: b.ogTitle ?? '',
    ogDescription: b.ogDescription ?? '',
    themeColor: b.themeColor ?? ''
  })

  const invalidate = [['api', 'admin/branding']]

  const save = useApiMutation({
    fn: () => api.put('admin/branding/meta', { ...form, keywords: form.keywords.split(',').map(k => k.trim()).filter(Boolean) }),
    invalidate,
    success: 'Name and metadata updated on the site'
  })

  const reset = useApiMutation({ fn: () => api.delete('admin/branding/meta'), invalidate, success: "Back to the platform's name and metadata" })

  const field = (key: keyof typeof form) => ({
    id: `brand-${key}`,
    name: key,
    value: form[key],
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value })
  })

  return (
    <form
      className='grid gap-4'
      onSubmit={e => {
        e.preventDefault()
        save.mutate(undefined, { onError: f.fromServer })
      }}
    >
      <FormErrorsProvider errors={f.errors} onClear={f.clear}>
        <TextField label='Site name' maxLength={40} {...field('siteName')} />
        <TextField label='Page title' maxLength={70} {...field('title')} />
        <TextField label='Title template' hint='%s is the page name, e.g. "%s · Parker567".' maxLength={80} {...field('titleTemplate')} />
        <TextAreaField label='Meta description' maxLength={300} rows={3} {...field('description')} />
        <TextField label='Meta keywords' hint='Comma-separated, up to 20.' {...field('keywords')} />
        <TextField label='Open Graph title' maxLength={90} {...field('ogTitle')} />
        <TextAreaField label='Open Graph description' maxLength={300} rows={3} {...field('ogDescription')} />
        <TextField label='Theme colour' placeholder='#24EE89' maxLength={7} {...field('themeColor')} />
      </FormErrorsProvider>
      <div className='flex gap-2'>
        <Button type='submit' size='sm' disabled={save.isPending}>
          Save
        </Button>
        {b.metaBy === 'site' && (
          <Button type='button' size='sm' variant='ghost' disabled={reset.isPending} onClick={() => reset.mutate()} title="Back to the platform's name and metadata">
            <RotateCcwIcon /> Reset
          </Button>
        )}
      </div>
    </form>
  )
}

/**
 * Site config → Branding: the site's name, page metadata and logo as players get them. The
 * platform sets them (owner panel); the Super Admin can also change them here — the latest wins.
 */
const Branding = () => {
  const brandingPoll = useLivePoll(15_000)
  const q = useApi<SiteBranding>('admin/branding', undefined, { refetchInterval: brandingPoll })
  const b = q.data
  const { can, actor } = useSession()
  const canEdit = actor?.direct === true && can('config:write')

  return (
    <div>
      <PageHeader title='Branding' description="The site's name, page title and meta tags, and its logo, as players get them." />
      <Alert className='mb-4'>
        <LockIcon />
        <AlertDescription>
          {canEdit
            ? 'Set by the platform. The name, metadata, logo and icon can also be changed here; the latest change, here or by the platform, is what players see.'
            : 'The name and metadata are managed by the platform.'}
        </AlertDescription>
      </Alert>
      {q.error && <ErrorState error={q.error} />}
      {q.isLoading || !b ? (
        <Skeleton className='h-64 w-full max-w-3xl' />
      ) : (
        <div className='grid max-w-5xl gap-4 lg:grid-cols-2'>
          <Card className='shadow-none'>
            <CardHeader>
              <CardTitle className='flex items-center gap-2 text-base'>
                Name and metadata {b.branded ? <Badge variant='secondary'>Branded</Badge> : <Badge variant='outline'>Not branded</Badge>}
              </CardTitle>
              <CardDescription>
                Version {b.version}
                {b.metaBy === 'site' ? ' · set here by the Super Admin' : ''}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {canEdit ? (
                <MetaForm key={JSON.stringify([b.siteName, b.title, b.titleTemplate, b.description, b.keywords, b.ogTitle, b.ogDescription, b.themeColor])} b={b} />
              ) : (
              <dl className='divide-y'>
                <Row label='Site name' value={b.siteName} />
                <Row label='Page title' value={b.title} />
                <Row label='Title template' value={b.titleTemplate} />
                <Row label='Meta description' value={b.description} />
                <Row label='Meta keywords' value={b.keywords.join(', ')} />
                <Row label='Open Graph title' value={b.ogTitle} />
                <Row label='Open Graph description' value={b.ogDescription} />
                <Row label='Theme colour' value={b.themeColor} />
              </dl>
              )}
            </CardContent>
          </Card>
          <Card className='shadow-none'>
            <CardHeader>
              <CardTitle className='text-base'>Logo and icons</CardTitle>
              <CardDescription>On the site&apos;s dark header colour and on white.</CardDescription>
            </CardHeader>
            <CardContent className='grid gap-4'>
              <div className='flex flex-wrap gap-4'>
                <Picture label='Logo' url={src(b.logoUrl)} className='h-8 w-36 object-contain' />
                <Picture label='Logo (light)' url={src(b.logoUrl)} className='h-8 w-36 object-contain' dark={false} />
              </div>
              {canEdit && <SiteImage slot='logo' />}
              <div className='flex flex-wrap gap-4'>
                <Picture label='Square mark / favicon' url={src(b.markUrl)} className='size-10 object-contain' />
                <Picture label='Open Graph image' url={src(b.ogImageUrl)} className='max-h-14 max-w-28 object-contain' />
              </div>
              {canEdit && <SiteImage slot='mark' />}
              {canEdit && <p className='text-muted-foreground text-xs'>PNG, WebP or SVG, up to 256 KB. Logo: wide, transparent (576×128 is sharp). Icon: square.</p>}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

export default Branding
