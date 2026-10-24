'use client'

import { useRef, useState } from 'react'

import { ImageIcon, Loader2Icon, Trash2Icon, UploadIcon } from 'lucide-react'
import { toast } from 'sonner'

import ErrorState from '@/components/shared/ErrorState'
import PageHeader from '@/components/shared/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api, ApiError, errorMessage, readEnvelope, send } from '@/lib/api/client'
import { toastError, toastSaved, type SaveResult } from '@/lib/api/feedback'
import { withBase } from '@/lib/basePath'
import {
  BAD_TEXT,
  BRANDING_LABELS,
  BRANDING_SLOTS,
  brandingProblem,
  diffBranding,
  inspectBrandingImage,
  keywordList,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_SIDE,
  MAX_KEYWORD_LENGTH,
  MAX_KEYWORDS,
  TEXT_KEYS,
  TEXT_LIMITS,
  type Branding as BrandingDoc,
  type BrandingAsset,
  type BrandingSlot,
  type BrandingTextKey
} from '@/lib/entitlements/branding'
import type { Change, EditableDoc, EntitlementsDoc } from '@/lib/entitlements/types'
import { cn } from '@/lib/utils'
import ChangeList from '../entitlements/ChangeList'

/* Images uploaded in this tab, by file name: the upload answers the bytes as a data URL, so the
   preview draws straight from it — no second request, and no dependence on the asset route being
   reachable (the panel behind a proxy path). The document itself only ever holds the reference. */
const previews = new Map<string, string>()

const assetUrl = (a: BrandingAsset | null) =>
  a ? (previews.get(a.file) ?? withBase(`/api/owner/branding/asset/${a.file}`)) : null

/** `{ success, data }` from the multipart upload (the JSON client does not send FormData). */
async function upload(slot: BrandingSlot, file: File): Promise<BrandingAsset> {
  const body = new FormData()

  body.set('file', file)
  const res = await send(`/api/owner/branding/upload?slot=${slot}`, { method: 'POST', body, cache: 'no-store' })
  const { dataUrl, ...asset } = await readEnvelope<BrandingAsset & { dataUrl?: string }>(res)

  if (dataUrl) previews.set(asset.file, dataUrl)

  return asset
}

/**
 * The upload rules, checked in the browser before anything is sent: the same `inspectBrandingImage`
 * the server runs (PNG / WebP by magic bytes, inert SVG, KB per slot, sides ≤ 4096, the logo ≥ 1.5:1,
 * the mark 0.8–1.25). Null = fine; the server checks again on receipt.
 */
async function precheck(slot: BrandingSlot, file: File): Promise<string | null> {
  const max = MAX_IMAGE_BYTES[slot]

  if (file.size > max) return `${file.name} is ${(file.size / 1024).toFixed(0)} KB; ${BRANDING_LABELS[slot]} is at most ${max / 1024} KB`
  const image = inspectBrandingImage(new Uint8Array(await file.arrayBuffer()), slot)

  return image.ok ? null : image.reason
}

/** Each field's problem, the same rules as the save (brandingProblem), so it is shown under the field. */
function fieldProblems(b: BrandingDoc): Partial<Record<keyof BrandingDoc, string>> {
  const out: Partial<Record<keyof BrandingDoc, string>> = {}

  for (const key of TEXT_KEYS) {
    const v = b[key]

    if (v.trim().length > TEXT_LIMITS[key]) out[key] = `At most ${TEXT_LIMITS[key]} characters (now ${v.trim().length})`
    else if (BAD_TEXT.test(v)) out[key] = 'No < > or control characters'
  }

  const anythingElse = (Object.keys(b) as (keyof BrandingDoc)[]).some(k => {
    const v = b[k]

    return k !== 'siteName' && (Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? !!v.trim() : !!v)
  })

  if (!out.siteName && anythingElse && !b.siteName.trim()) out.siteName = 'Required once anything is branded (it is also the logo alt text)'

  const template = b.titleTemplate.trim()

  if (!out.titleTemplate && template && template.split('%s').length !== 2)
    out.titleTemplate = template.includes('%s') ? 'Use %s only once' : 'Must contain %s (where the page title goes)'

  if (b.keywords.length > MAX_KEYWORDS) out.keywords = `At most ${MAX_KEYWORDS} keywords (now ${b.keywords.length})`
  else if (b.keywords.some(w => w.length > MAX_KEYWORD_LENGTH))
    out.keywords = `Each keyword is at most ${MAX_KEYWORD_LENGTH} characters: “${b.keywords.find(w => w.length > MAX_KEYWORD_LENGTH)!.slice(0, 20)}…”`
  else if (b.keywords.some(w => BAD_TEXT.test(w))) out.keywords = 'No < > or control characters'

  if (b.themeColor.trim() && !/^#[0-9a-fA-F]{6}$/.test(b.themeColor.trim())) out.themeColor = 'Must look like #1A2B3C, or be empty'

  return out
}

const SLOT_HELP: Record<BrandingSlot, string> = {
  logo: 'The wordmark in the header, footer, region pop-up, bet slip and the house provider row. Drawn in the 4.5:1 box the original wordmark fills (288x64; upload 576x128 for sharp screens). Transparent, light ink for the dark theme.',
  mark: 'Square: the favicon, the signed-in mobile header and the loading screen. 128x128 or larger.',
  ogImage: 'The picture a shared link shows (1200x630 is the usual size). Optional.'
}

const ImageSlot = ({
  slot,
  value,
  onChange,
  error,
  onError
}: {
  slot: BrandingSlot
  value: BrandingAsset | null
  onChange: (a: BrandingAsset | null) => void
  error?: string
  onError: (message: string | null) => void
}) => {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const url = assetUrl(value)
  const label = BRANDING_LABELS[slot]

  const pick = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    onError(null)

    try {
      const refused = await precheck(slot, file)

      if (refused) {
        onError(refused)
        toast.error(`${label} not uploaded`, { description: refused })

        return
      }

      const asset = await upload(slot, file)

      onChange(asset)
      toast.success(`${label} uploaded`, {
        description: `${asset.width && asset.height ? `${asset.width}x${asset.height}, ` : ''}${(asset.bytes / 1024).toFixed(1)} KB. Review and save to put it live.`
      })
    } catch (e) {
      onError(errorMessage(e))
      toastError(e, `${label} not uploaded`)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <Field>
      <FieldLabel>{BRANDING_LABELS[slot]}</FieldLabel>
      <div className='flex flex-wrap items-center gap-3'>
        {/* On the site's dark header colour and on white, so a logo that vanishes on one shows. */}
        <div className={cn('flex items-center gap-2', slot === 'mark' ? '' : 'flex-col items-start sm:flex-row')}>
          {['#232626', '#FFFFFF'].map(bg => (
            <div
              key={bg}
              className={cn('flex items-center justify-center rounded-md border', slot === 'logo' ? 'h-14 w-48' : slot === 'mark' ? 'size-14' : 'h-16 w-32')}
              style={{ background: bg }}
            >
              {url ? (
                 
                <img src={url} alt='' className={cn('object-contain', slot === 'logo' ? 'h-8 w-36' : slot === 'mark' ? 'size-9' : 'max-h-14 max-w-28')} />
              ) : (
                <ImageIcon className='text-muted-foreground size-5' />
              )}
            </div>
          ))}
        </div>
        <div className='flex flex-col gap-1.5'>
          <div className='flex gap-2'>
            <Button type='button' variant='outline' size='sm' disabled={busy} onClick={() => input.current?.click()}>
              {busy ? <Loader2Icon className='animate-spin' /> : <UploadIcon />} {busy ? 'Uploading…' : value ? 'Replace' : 'Upload'}
            </Button>
            {value && (
              <Button
                type='button'
                variant='ghost'
                size='sm'
                disabled={busy}
                onClick={() => {
                  onChange(null)
                  onError(null)
                  toast.info(`${label} removed`, { description: 'Review and save to put it live; empty keeps the UI’s own.' })
                }}
                aria-label={`Remove ${label}`}
              >
                <Trash2Icon /> Remove
              </Button>
            )}
          </div>
          {value && (
            <span className='text-muted-foreground font-mono text-xs'>
              {value.type.replace('image/', '').replace('+xml', '')} · {value.width && value.height ? `${value.width}x${value.height} · ` : ''}
              {(value.bytes / 1024).toFixed(1)} KB · {value.file.slice(0, 10)}…
            </span>
          )}
        </div>
      </div>
      <input
        ref={input}
        type='file'
        className='hidden'
        accept='image/png,image/webp,image/svg+xml,.png,.webp,.svg'
        aria-label={`${BRANDING_LABELS[slot]} file`}
        data-slot={slot}
        onChange={e => void pick(e.target.files?.[0])}
      />
      {error && (
        <p className='text-destructive text-xs' role='alert' data-error={`branding-${slot}`}>
          {error}
        </p>
      )}
      <FieldDescription>
        {SLOT_HELP[slot]} PNG, WebP or SVG, at most {MAX_IMAGE_BYTES[slot] / 1024} KB, each side at most {MAX_IMAGE_SIDE} px. Checked by its bytes; an SVG with script, event
        attributes or external references is refused.
      </FieldDescription>
    </Field>
  )
}

type TextFieldProps = { name: BrandingTextKey; value: string; onChange: (v: string) => void; placeholder?: string; help?: string; multiline?: boolean; error?: string }

const TextField = ({ name, value, onChange, placeholder, help, multiline, error }: TextFieldProps) => {
  const id = `branding-${name}`
  const Control = multiline ? Textarea : Input

  return (
    <Field>
      <div className='flex items-baseline justify-between gap-2'>
        <FieldLabel htmlFor={id}>{BRANDING_LABELS[name]}</FieldLabel>
        <span className={cn('text-xs tabular-nums', value.trim().length > TEXT_LIMITS[name] ? 'text-destructive' : 'text-muted-foreground')}>
          {value.length}/{TEXT_LIMITS[name]}
        </span>
      </div>
      <Control
        id={id}
        name={name}
        value={value}
        placeholder={placeholder}
        autoComplete='off'
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={e => onChange(e.target.value)}
      />
      {error && (
        <p id={`${id}-error`} className='text-destructive text-xs' role='alert' data-error={id}>
          {error}
        </p>
      )}
      {help && <FieldDescription>{help}</FieldDescription>}
    </Field>
  )
}

/**
 * The site's name, page metadata and logo files. Saved in the entitlements document
 * (`branding`) like every owner change: Review and save → new version → audit → the site pulls
 * it within seconds. Uploads are stored here and only go live with the save.
 */
const Branding = () => {
  const { data: doc, error, isLoading, refetch, isRefetching } = useApi<EditableDoc>('/api/owner/entitlements')
  const [draft, setDraft] = useState<BrandingDoc | null>(null)
  const [slotErrors, setSlotErrors] = useState<Partial<Record<BrandingSlot, string>>>({})
  const [keywordsText, setKeywordsText] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState(false)

  const saved = doc?.branding ?? null
  const current: BrandingDoc | null = draft ?? saved
  const changes: Change[] = saved && current ? diffBranding(saved, current) : []
  const fields = current ? fieldProblems(current) : {}
  const fieldCount = Object.keys(fields).length
  const problem = fieldCount ? `Fix ${fieldCount} field${fieldCount === 1 ? '' : 's'} before saving: ${Object.values(fields)[0]}` : current ? brandingProblem(current) : null
  const slotError = (slot: BrandingSlot) => (msg: string | null) => setSlotErrors(prev => ({ ...prev, [slot]: msg ?? undefined }))

  const set = <K extends keyof BrandingDoc>(key: K, value: BrandingDoc[K]) => setDraft(prev => ({ ...(prev ?? saved!), [key]: value }))

  const discard = () => {
    setDraft(null)
    setKeywordsText(null)
    setSlotErrors({})
  }

  const save = useApiMutation<void, SaveResult & { doc: EntitlementsDoc; changes: Change[] }>({
    // Only `branding` changes; features, flags, variants and the template stay as stored.
    fn: () => api.put('/api/owner/entitlements', { version: doc!.version, features: {}, flags: {}, branding: current }),
    invalidate: [['api']],
    errorTitle: 'Branding not saved',
    onSuccess: r => {
      toastSaved(r, 'Branding saved')
      discard()
      setReviewing(false)
    }
  })

  if (error)
    return (
      <>
        <PageHeader title='Branding' />
        <ErrorState error={error} title='Could not load the branding' onRetry={refetch} retrying={isRefetching} />
      </>
    )

  const pageTitle = current?.title || current?.siteName || ''
  const sample = current?.titleTemplate ? current.titleTemplate.replace('%s', 'Casino') : pageTitle

  return (
    <div className={cn(changes.length > 0 && 'pb-20')}>
      <PageHeader
        title='Branding'
        description="The site's name, its page title and meta tags, and the logo files players see. The site admin shows them read-only. An empty field keeps the UI's own."
      />

      {isLoading || !current ? (
        <div className='flex flex-col gap-2'>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className='h-12 w-full' />
          ))}
        </div>
      ) : (
        <div className='grid gap-4 lg:grid-cols-2'>
          <Card>
            <CardHeader>
              <CardTitle>Name and page metadata</CardTitle>
              <CardDescription>The browser tab, search results and the site&apos;s own mentions of its name.</CardDescription>
            </CardHeader>
            <CardContent className='flex flex-col gap-4'>
              <TextField error={fields.siteName} name='siteName' value={current.siteName} onChange={v => set('siteName', v)} placeholder='parker567' help='Required once branded. Also the alt text of the logo.' />
              <TextField error={fields.title} name='title' value={current.title} onChange={v => set('title', v)} placeholder='Parker567 — Casino & Sports' help='The home page title (and the default for every page).' />
              <TextField
                name='titleTemplate'
                error={fields.titleTemplate}
                value={current.titleTemplate}
                onChange={v => set('titleTemplate', v)}
                placeholder='%s · Parker567'
                help='How a page with its own title is named; %s is that title. Empty = the page title alone.'
              />
              <TextField error={fields.description} name='description' value={current.description} onChange={v => set('description', v)} multiline help='<meta name="description">, shown under the title in search results.' />
              <Field>
                <div className='flex items-baseline justify-between gap-2'>
                  <FieldLabel htmlFor='branding-keywords'>{BRANDING_LABELS.keywords}</FieldLabel>
                  <span className={cn('text-xs tabular-nums', current.keywords.length > MAX_KEYWORDS ? 'text-destructive' : 'text-muted-foreground')}>
                    {current.keywords.length}/{MAX_KEYWORDS}
                  </span>
                </div>
                <Input
                  id='branding-keywords'
                  name='keywords'
                  autoComplete='off'
                  aria-invalid={!!fields.keywords}
                  placeholder='crypto casino, sports betting, originals'
                  value={keywordsText ?? current.keywords.join(', ')}
                  onChange={e => {
                    setKeywordsText(e.target.value)
                    set('keywords', keywordList(e.target.value))
                  }}
                />
                {fields.keywords && (
                  <p className='text-destructive text-xs' role='alert' data-error='branding-keywords'>
                    {fields.keywords}
                  </p>
                )}
                <FieldDescription>Comma-separated; at most {MAX_KEYWORDS}, each at most {MAX_KEYWORD_LENGTH} characters.</FieldDescription>
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Logo and icons</CardTitle>
              <CardDescription>Only the image changes: each one is drawn in the original&apos;s box, at the same size and place.</CardDescription>
            </CardHeader>
            <CardContent className='flex flex-col gap-5'>
              <ImageSlot slot='logo' value={current.logo} onChange={a => set('logo', a)} error={slotErrors.logo} onError={slotError('logo')} />
              <ImageSlot slot='mark' value={current.mark} onChange={a => set('mark', a)} error={slotErrors.mark} onError={slotError('mark')} />
              <Field>
                <FieldLabel htmlFor='branding-themeColor'>{BRANDING_LABELS.themeColor}</FieldLabel>
                <div className='flex items-center gap-2'>
                  <input
                    type='color'
                    aria-label='Pick the theme colour'
                    className='h-9 w-12 cursor-pointer rounded-md border bg-transparent p-1'
                    value={/^#[0-9a-fA-F]{6}$/.test(current.themeColor) ? current.themeColor : '#232626'}
                    onChange={e => set('themeColor', e.target.value.toUpperCase())}
                  />
                  <Input
                    id='branding-themeColor'
                    name='themeColor'
                    className='w-32 font-mono'
                    placeholder='#232626'
                    maxLength={7}
                    aria-invalid={!!fields.themeColor}
                    value={current.themeColor}
                    onChange={e => set('themeColor', e.target.value)}
                  />
                  {current.themeColor && (
                    <Button type='button' variant='ghost' size='sm' onClick={() => set('themeColor', '')}>
                      Clear
                    </Button>
                  )}
                </div>
                {fields.themeColor && (
                  <p className='text-destructive text-xs' role='alert' data-error='branding-themeColor'>
                    {fields.themeColor}
                  </p>
                )}
                <FieldDescription>Optional: the mobile browser bar&apos;s colour. Empty keeps the UI&apos;s own.</FieldDescription>
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sharing (Open Graph)</CardTitle>
              <CardDescription>What a link to the site shows in chats and social posts. Empty fields fall back to the title and description.</CardDescription>
            </CardHeader>
            <CardContent className='flex flex-col gap-4'>
              <TextField error={fields.ogTitle} name='ogTitle' value={current.ogTitle} onChange={v => set('ogTitle', v)} placeholder={current.title || 'Page title'} />
              <TextField error={fields.ogDescription} name='ogDescription' value={current.ogDescription} onChange={v => set('ogDescription', v)} multiline placeholder={current.description} />
              <ImageSlot slot='ogImage' value={current.ogImage} onChange={a => set('ogImage', a)} error={slotErrors.ogImage} onError={slotError('ogImage')} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Preview</CardTitle>
              <CardDescription>The tab and a search result, as saved here.</CardDescription>
            </CardHeader>
            <CardContent className='flex flex-col gap-4'>
              <div className='bg-muted flex w-fit max-w-full items-center gap-2 rounded-t-lg px-3 py-2 text-sm'>
                {current.mark ? (
                   
                  <img src={assetUrl(current.mark)!} alt='' className='size-4' />
                ) : (
                  <span className='bg-muted-foreground/30 size-4 rounded-sm' />
                )}
                <span className='truncate'>{pageTitle || 'bc-games'}</span>
              </div>
              <div className='rounded-lg border p-3'>
                <div className='text-muted-foreground text-xs'>{current.siteName || 'site'} › casino</div>
                <div className='truncate text-base font-medium text-blue-600 dark:text-blue-400'>{sample || 'Casino'}</div>
                <p className='text-muted-foreground line-clamp-2 text-sm'>{current.description || 'No description: search engines pick their own snippet.'}</p>
              </div>
              {current.keywords.length > 0 && (
                <div className='flex flex-wrap gap-1'>
                  {current.keywords.map(k => (
                    <Badge key={k} variant='secondary'>
                      {k}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {changes.length > 0 && (
        <div className='bg-background/95 fixed inset-x-0 bottom-0 z-20 border-t backdrop-blur'>
          <div className='mx-auto flex max-w-7xl items-center justify-between gap-3 px-6 py-3'>
            <span className={cn('text-sm', problem && 'text-destructive')} role={problem ? 'alert' : undefined} data-save-blocked={problem ? '' : undefined}>
              {problem ?? `${changes.length} unsaved change${changes.length === 1 ? '' : 's'}`}
            </span>
            <div className='flex gap-2'>
              <Button
                variant='outline'
                disabled={save.isPending}
                onClick={() => {
                  discard()
                  toast.info('Changes discarded')
                }}
              >
                Discard
              </Button>
              <Button disabled={!!problem} onClick={() => setReviewing(true)}>
                Review and save
              </Button>
            </div>
          </div>
        </div>
      )}

      <Dialog open={reviewing} onOpenChange={setReviewing}>
        <DialogContent className='sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>Save branding</DialogTitle>
            <DialogDescription>
              Version {doc?.version} → {(doc?.version ?? 0) + 1}. The site picks this up within seconds.
            </DialogDescription>
          </DialogHeader>
          <div className='max-h-[60vh] overflow-y-auto'>
            <ChangeList changes={changes} labelOf={c => c.key} />
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setReviewing(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <Button
              disabled={save.isPending || !!problem}
              onClick={() =>
                save.mutate(undefined, {
                  onError: e => {
                    if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') {
                      toast.info('Reloaded the latest version; your edits are kept on top of it.')
                      void refetch()
                    }

                    // "logo: <file> was not uploaded here" → under that image.
                    if (e instanceof ApiError && e.code === 'BRANDING_FILE_MISSING') {
                      const slot = BRANDING_SLOTS.find(x => e.message.startsWith(`${x}:`))

                      if (slot) slotError(slot)('This image is not stored on the panel any more — upload it again.')
                      setReviewing(false)
                    }
                  }
                })
              }
            >
              {save.isPending && <Loader2Icon className='animate-spin' />} Save {changes.length} change{changes.length === 1 ? '' : 's'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default Branding
