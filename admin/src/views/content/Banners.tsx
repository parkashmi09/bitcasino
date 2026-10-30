'use client'

import { useEffect, useMemo, useState } from 'react'

import { ImageIcon, UploadIcon } from 'lucide-react'

import Can from '@/components/shared/Can'
import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import FormDialog from '@/components/shared/FormDialog'
import { SelectField, TextField } from '@/components/shared/FormField'
import PageHeader from '@/components/shared/PageHeader'
import StatusBadge from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { check } from '@/lib/validate'
import TabbedPage from '@/components/shared/TabbedPage'

import type { Banner, BannerMode } from './types'

/**
 * Banners are addressed by PLACEMENT, not by id: uploading `hero-1` again
 * replaces that slide. The image bytes live in the database and are served
 * from `admin/banners/image/:filename`, so a preview is an `<img>` at the
 * proxy URL rather than a blob fetch.
 */
const bannerImageUrl = (b: Banner) => api.url(`admin/banners/${b.type}`).replace(/\/banners\/.*$/, `/banners/image/${encodeURIComponent(b.type)}`)

/**
 * Where a placement shows on the site, and the image that suits it. Picking one fills the
 * placement name; "Other" takes any name for a template that reads its own.
 */
const PLACEMENTS: { value: string; label: string; hint: string; mode: BannerMode }[] = [
  { mode: 'direct', value: 'home', label: 'Home · hero banner', hint: 'The signed-out home hero, right-aligned at full height (desktop, 260px tall). A finished banner about 2000×520, art on the right; the sign-up copy sits on the left.' },
  { mode: 'direct', value: 'home_mobile', label: 'Home · hero banner (mobile)', hint: 'The same hero below 1024px, 230px tall, right-aligned. About 900×460. Falls back to the desktop banner when missing.' },
  ...[1, 2, 3, 4, 5, 6].map(n => ({
    mode: 'direct' as const,
    value: `slider-${n}`,
    label: `Promo slider · slide ${n}`,
    hint: 'With a title: copy on the left, the image as art on the right (transparent cut-out, about 700×700). Without a title: a finished banner covering the card, about 900×420.'
  })),
  ...[1, 2, 3, 4, 5, 6].map(n => ({
    mode: 'agent' as const,
    value: `agent-slider-${n}`,
    label: `Agent mode slider · slide ${n}`,
    hint: 'Shown to agent players after sign-in (/agent), on home and casino. A game banner, never a promotion: link it to /casino or /sports. Art on the right of a dark card, about 840×420. With none uploaded the site shows its four built-in game banners.'
  })),
  ...[1, 2, 3, 4, 5, 6].map(n => ({
    mode: 'direct' as const,
    value: `partner-${n}`,
    label: `Home · partner ${n}`,
    hint: 'One tile of the home Partners strip. The title is the partner name ("Official Partner of …"), the image a transparent photo, about 400×320. The strip is hidden until one is added.'
  })),
  { mode: 'direct', value: 'casino', label: 'Casino · wide promo banner', hint: 'A finished banner across the casino lobby, about 1280×260.' }
]

/** banners.constants.js AGENT_PREFIX: an `agent-…` placement is agent mode's. */
const AGENT_PREFIX = 'agent-'

const OTHER = '__other__'

/** banners.constants.js TYPE_PATTERN and common imageUpload MAX_UPLOAD_BYTES (4 MB). */
const TYPE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']

const blankForm = (b?: Banner) => ({
  type: b?.type ?? '',
  title: b?.title ?? '',
  subtitle: b?.subtitle ?? '',
  ctaLabel: b?.cta?.label ?? '',
  ctaHref: b?.cta?.href ?? '',
  sortOrder: String(b?.sortOrder ?? 0)
})

const UploadBanner = ({ existing, mode }: { existing?: Banner; mode: BannerMode }) => {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(() => blankForm(existing))
  const [file, setFile] = useState<File | null>(null)
  const placements = PLACEMENTS.filter(p => p.mode === mode)
  const preset = PLACEMENTS.find(p => p.value === form.type)
  const [other, setOther] = useState(() => !!existing && !preset)

  // The chosen file's preview lives only while it is chosen.
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  // Every open starts from the banner as it is now (or blank), never from the last upload.
  const onOpenChange = (next: boolean) => {
    if (next) {
      setForm(blankForm(existing))
      setFile(null)
      setOther(!!existing && !PLACEMENTS.some(p => p.value === existing.type))
    }

    setOpen(next)
  }

  const upload = useApiMutation({
    fn: () => {
      const fd = new FormData()

      fd.set('type', form.type)
      for (const k of ['title', 'subtitle', 'ctaLabel', 'ctaHref'] as const) if (form[k]) fd.set(k, form[k])
      if (form.sortOrder !== '') fd.set('sortOrder', form.sortOrder)
      if (file) fd.set('image', file)

      return api.upload<Banner>('admin/banners', fd)
    },
    invalidate: [['api', 'admin/banners']],
    success: b => `Placement ${b?.type ?? form.type} saved`
  })

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        existing ? (
          <Button variant='ghost' size='sm'>
            Edit
          </Button>
        ) : (
          <Button>
            <UploadIcon /> Upload banner
          </Button>
        )
      }
      title={existing ? `Edit ${existing.type}` : 'Upload a banner'}
      description='The placement is the address: saving the same one again replaces it. A call to action needs both its label and its link, or neither.'
      submitLabel={existing ? 'Save' : 'Upload'}
      onSubmit={() => upload.mutateAsync()}
      validate={() => {
        const hasLabel = !!form.ctaLabel.trim()
        const hasHref = !!form.ctaHref.trim()

        return {
          [existing ? 'b-type' : other ? 'b-type' : 'b-place']: !form.type.trim()
            ? 'Choose a placement'
            : !TYPE_PATTERN.test(form.type.trim())
              ? 'Placement: lowercase letters, digits, dash and underscore only (max 64)'
              : form.type.trim().startsWith(AGENT_PREFIX) !== (mode === 'agent')
                ? mode === 'agent'
                  ? `An agent mode placement starts with ${AGENT_PREFIX}`
                  : `${AGENT_PREFIX}… placements belong to the Agent mode tab`
                : undefined,
          'b-image': !file
            ? existing
              ? undefined
              : 'Choose an image'
            : !IMAGE_TYPES.includes(file.type)
              ? 'The image must be PNG, JPEG or WebP'
              : file.size > MAX_IMAGE_BYTES
                ? `The image is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 4 MB`
                : undefined,
          'b-title': check.length(form.title, 'Title', { max: 160 }),
          'b-sub': check.length(form.subtitle, 'Subtitle', { max: 300 }),
          'b-cta': hasHref && !hasLabel ? 'A CTA link needs a label' : check.length(form.ctaLabel, 'CTA label', { max: 60 }),
          'b-href':
            hasLabel && !hasHref
              ? 'A CTA label needs a link'
              : hasHref && !/^(\/[^\s]*|https?:\/\/[^\s]+)$/i.test(form.ctaHref.trim())
                ? 'CTA link must be a site path (/casino) or an http(s) URL'
                : check.length(form.ctaHref, 'CTA link', { max: 500 }),
          'b-sort': check.number(form.sortOrder, 'Sort order', { integer: true, min: 0, max: 9999, optional: true })
        }
      }}
    >
      {existing ? (
        <TextField id='b-type' label='Placement' readOnly value={form.type} hint={preset?.hint} />
      ) : (
        <>
          <SelectField
            id='b-place'
            label='Placement *'
            placeholder='Where it shows'
            value={other ? OTHER : form.type}
            onChange={v => {
              setOther(v === OTHER)
              setForm({ ...form, type: v === OTHER ? '' : v })
            }}
            options={[...placements.map(p => ({ value: p.value, label: p.label })), { value: OTHER, label: 'Other (type a name)' }]}
            hint={preset?.hint}
          />
          {other && (
            <TextField
              id='b-type'
              label='Placement name'
              required
              hint={mode === 'agent' ? 'Starts with agent- — e.g. agent-slider-7' : 'Lowercase letters, digits, dash and underscore — e.g. hero-1, home_welcome'}
              value={form.type}
              onChange={e => setForm({ ...form, type: e.target.value.toLowerCase() })}
            />
          )}
        </>
      )}
      <div className='grid gap-2'>
        <label htmlFor='b-image' className='text-sm font-medium'>
          Image {existing ? '(leave empty to keep the current one)' : '*'}
        </label>
        <span className='text-muted-foreground text-xs'>PNG, JPEG or WebP, up to 4 MB.</span>
        <input id='b-image' type='file' accept='image/png,image/jpeg,image/webp' className='text-sm' onChange={e => setFile(e.target.files?.[0] ?? null)} required={!existing} />
        {(preview || existing) && (
           
          <img
            src={preview ?? bannerImageUrl(existing!)}
            alt={preview ? 'The new image' : 'The current image'}
            className='bg-muted max-h-40 w-full rounded border object-contain'
          />
        )}
      </div>
      <TextField id='b-title' name='title' label='Title' maxLength={160} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
      <TextField id='b-sub' name='subtitle' label='Subtitle' maxLength={300} value={form.subtitle} onChange={e => setForm({ ...form, subtitle: e.target.value })} />
      <div className='grid grid-cols-2 gap-4'>
        <TextField id='b-cta' name='ctaLabel' label='CTA label' maxLength={60} value={form.ctaLabel} onChange={e => setForm({ ...form, ctaLabel: e.target.value })} />
        <TextField id='b-href' name='ctaHref' label='CTA link' hint='/casino or https://…' value={form.ctaHref} onChange={e => setForm({ ...form, ctaHref: e.target.value })} />
      </div>
      <TextField id='b-sort' label='Sort order' type='number' min={0} max={9999} value={form.sortOrder} onChange={e => setForm({ ...form, sortOrder: e.target.value })} />
    </FormDialog>
  )
}

const BannerList = ({ mode }: { mode: BannerMode }) => {
  const [showInactive, setShowInactive] = useState(true)
  const list = useApi<Banner[]>('admin/banners', { includeInactive: showInactive, mode }, { retry: false })

  const setActive = useApiMutation({
    fn: (v: { type: string; active: boolean }) => api.patch(`admin/banners/${v.type}/active`, { active: v.active }),
    invalidate: [['api', 'admin/banners']],
    success: (_r, v) => `${v.type} is now ${v.active ? 'visible' : 'hidden'}`
  })

  const columns: Column<Banner>[] = [
    {
      key: 'preview',
      header: 'Preview',
      cell: b => (
         
        <img src={bannerImageUrl(b)} alt={b.type} className='bg-muted h-10 w-24 rounded object-cover' onError={e => (e.currentTarget.style.visibility = 'hidden')} />
      )
    },
    { key: 'type', header: 'Placement', cell: b => <span className='font-mono text-xs'>{b.type}</span> },
    {
      key: 'copy',
      header: 'Copy',
      cell: b => (
        <span className='block max-w-80'>
          <span className='block truncate text-sm'>{b.title ?? <span className='text-muted-foreground'>no title</span>}</span>
          <span className='text-muted-foreground block truncate text-xs'>{b.subtitle ?? ''}</span>
        </span>
      )
    },
    { key: 'cta', header: 'CTA', cell: b => (b.cta ? <span className='text-xs'>{b.cta.label} → <code>{b.cta.href}</code></span> : <span className='text-muted-foreground'>—</span>) },
    { key: 'sort', header: 'Order', align: 'right', cell: b => <span className='tabular-nums'>{b.sortOrder}</span> },
    { key: 'active', header: 'Visible', cell: b => <Can permission='config:write' fallback={<StatusBadge value={b.active} />}><Switch checked={b.active} disabled={setActive.isPending} onCheckedChange={active => setActive.mutate({ type: b.type, active })} /></Can> },
    { key: 'at', header: 'Updated', cell: b => <DateTime value={b.updatedAt ?? b.createdAt} relative /> },
    { key: 'actions', header: '', align: 'right', cell: b => <Can permission='config:write'><UploadBanner existing={b} mode={mode} /></Can> }
  ]

  return (
    <div>
      <PageHeader
        title={mode === 'agent' ? 'Banners · Agent mode' : 'Banners · Direct users'}
        description={
          mode === 'agent'
            ? 'The game slider agent players see after sign-in on /agent. Game banners only, linked to /casino or /sports.'
            : 'Hero slides and promo artwork for direct players. A placement name is the address — re-uploading it replaces the image everywhere it is shown.'
        }
        actions={
          <>
            <label className='flex items-center gap-2 text-sm'>
              <Switch checked={showInactive} onCheckedChange={setShowInactive} /> Show hidden
            </label>
            <Can permission='config:write'>
              <UploadBanner mode={mode} />
            </Can>
          </>
        }
      />
      <DataTable
        columns={columns}
        rows={list.data}
        rowKey={b => b.type}
        loading={list.isLoading}
        fetching={list.isFetching}
        error={list.error}
        emptyMessage={
          <span className='flex flex-col items-center gap-1'>
            <ImageIcon className='text-muted-foreground size-5' />
            {mode === 'agent'
              ? 'No agent banner uploaded yet. /agent shows its four built-in game banners until one exists.'
              : 'No banner uploaded yet. The site falls back to its built-in artwork until one exists.'}
          </span>
        }
      />
    </div>
  )
}

/** Two modes, each its own list and placements: direct players' site, and agent mode (/agent). */
const Banners = () => (
  <TabbedPage
    tabs={[
      { value: 'direct', label: 'Direct users', render: () => <BannerList mode='direct' /> },
      { value: 'agent', label: 'Agent mode', render: () => <BannerList mode='agent' /> }
    ]}
  />
)

export default Banners
