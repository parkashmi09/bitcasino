'use client'

import { useRef, useState, type ReactNode } from 'react'

import Link from 'next/link'

import { CheckCircle2Icon, MonitorIcon, ImageIcon, Loader2Icon, SmartphoneIcon, UploadIcon, XCircleIcon } from 'lucide-react'

import { toast } from 'sonner'

import ErrorState from '@/components/shared/ErrorState'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { imageSrc, type PushButton, type PushStatus, type UploadedImage } from './types'

// ── Status card ─────────────────────────────────────────────────────────

const Row = ({ ok, label, children }: { ok: boolean; label: string; children?: ReactNode }) => (
  <div className='flex items-start gap-2 text-sm'>
    {ok ? <CheckCircle2Icon className='text-success mt-0.5 size-4 shrink-0' /> : <XCircleIcon className='text-danger mt-0.5 size-4 shrink-0' />}
    <div className='min-w-0'>
      <span className='font-medium'>{label}</span>
      {children && <div className='text-muted-foreground text-xs break-words'>{children}</div>}
    </div>
  </div>
)

/** Is OneSignal ready? Never shows a key — only whether one is set, and where to set it. */
export const PushStatusCard = () => {
  const { data: s, isLoading, error } = useApi<PushStatus>('admin/push/status')

  if (isLoading) return <Card className='mb-6 h-32 animate-pulse shadow-none' />
  if (error)
    return (
      <div className='mb-6'>
        <ErrorState error={error} title='Could not load the OneSignal status' />
      </div>
    )
  if (!s) return null

  return (
    <Card className='mb-6 shadow-none'>
      <CardHeader className='pb-2'>
        <CardTitle className='text-base'>OneSignal status — {s.ready ? 'ready to send' : s.sdkReady ? 'browser SDK on, sending blocked' : 'not switched on'}</CardTitle>
        <CardDescription>
          The keys live in the feature config, not here. Without them campaigns still write the bell (inbox) rows; nothing is pushed.
        </CardDescription>
      </CardHeader>
      <CardContent className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
        <Row ok={s.entitled && s.enabled} label={s.entitled ? (s.enabled ? 'Feature on (OneSignal)' : `Feature off (variant: ${s.variant})`) : 'Not in your plan'}>
          {!s.enabled || !s.entitled ? s.whereToSet.variant : null}
        </Row>
        <Row ok={s.appIdSet} label={s.appIdSet ? 'App ID set' : 'App ID missing'}>
          {s.appIdSet ? <span className='font-mono'>{s.appId}</span> : s.whereToSet.appId}
        </Row>
        <Row ok={s.apiKeySet} label={s.apiKeySet ? 'App API key set' : 'API key missing'}>
          {s.apiKeySet ? 'Stored sealed; never shown' : s.whereToSet.apiKey}
        </Row>
        <Row ok={s.imagesFetchable} label={s.imagesFetchable ? 'Images fetchable by OneSignal' : 'Images not fetchable'}>
          {s.publicOrigin ? `${s.publicOrigin} (${s.publicOriginSource})` : 'No public origin set'}
          {!s.imagesFetchable && ' — OneSignal needs a public https domain to fetch notification images (Prompt & settings → Public origin).'}
        </Row>
        {(!s.appIdSet || !s.apiKeySet) && (
          <div className='text-sm sm:col-span-2 lg:col-span-4'>
            <Link href='/site-config/features' className='text-primary underline underline-offset-2'>
              Open Site config → Features → Push notifications
            </Link>{' '}
            to paste the App ID and the App API key (starts <span className='font-mono'>os_v2_</span>).
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export const Warnings = ({ items, title = 'Check before sending' }: { items?: string[]; title?: string }) =>
  items?.length ? (
    <Alert className='border-warning/40'>
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <ul className='list-disc pl-4'>
          {items.map(w => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  ) : null

// ── Image picker: upload or URL ─────────────────────────────────────────

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'

export const ImageInput = ({
  id,
  label,
  value,
  onChange,
  hint,
  error
}: {
  id: string
  label: string
  value: string
  onChange: (url: string) => void
  hint?: ReactNode

  /** An inline message under the field (e.g. "must be an https URL"). */
  error?: string | false | null
}) => {
  const file = useRef<HTMLInputElement>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [meta, setMeta] = useState<string | null>(null)

  const upload = useApiMutation({
    fn: (f: File) => {
      const fd = new FormData()

      fd.append('image', f)

      return api.upload<UploadedImage>('admin/push/images', fd)
    },
    success: 'Image uploaded',
    onSuccess: r => {
      onChange(r.url)
      setWarnings(r.warnings ?? [])
      setMeta(`${r.width ?? '?'}×${r.height ?? '?'} · ${Math.round(r.byteSize / 1024)} KB · ${r.contentType}`)
    }
  })

  const src = imageSrc(value)

  return (
    <div className='grid gap-2'>
      <label htmlFor={id} className='text-sm font-medium'>
        {label}
      </label>
      <div className='flex gap-2'>
        <Input
          id={id}
          placeholder='https://… or upload'
          aria-invalid={error ? true : undefined}
          value={value}
          onChange={e => {
            onChange(e.target.value)
            setWarnings([])
            setMeta(null)
          }}
        />
        <input
          ref={file}
          type='file'
          accept={ACCEPT}
          className='hidden'
          onChange={e => {
            const f = e.target.files?.[0]

            e.target.value = ''
            if (!f) return

            // push images route: PNG/JPG/WebP/GIF, at most 1 MB — say so before the upload, not after.
            if (!ACCEPT.split(',').includes(f.type)) return void toast.error('The image must be PNG, JPG, WebP or GIF')
            if (f.size > 1024 * 1024) return void toast.error(`The image is ${(f.size / 1024 / 1024).toFixed(1)} MB — the limit is 1 MB`)
            upload.mutate(f)
          }}
        />
        <Button type='button' variant='outline' onClick={() => file.current?.click()} disabled={upload.isPending}>
          {upload.isPending ? <Loader2Icon className='animate-spin' /> : <UploadIcon />}
          Upload
        </Button>
        {value && (
          <Button type='button' variant='ghost' onClick={() => onChange('')}>
            Clear
          </Button>
        )}
      </div>
      {error && (
        <p role='alert' className='text-destructive text-sm'>
          {error}
        </p>
      )}
      <p className='text-muted-foreground text-xs'>{hint ?? 'PNG, JPG, WebP or GIF, at most 1 MB. 1440×720 (2:1) recommended. Must be https.'}</p>
      {src && (
        <div className='flex items-center gap-3'>
          { }
          <img src={src} alt='' className='bg-muted h-16 w-32 rounded border object-cover' />
          {meta && <span className='text-muted-foreground text-xs'>{meta}</span>}
        </div>
      )}
      {warnings.length > 0 && (
        <ul className='text-warning list-disc pl-4 text-xs'>
          {warnings.map(w => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Live preview: desktop Chrome + Android ─────────────────────────────

type PreviewProps = {
  title: string
  body: string
  imageUrl?: string | null
  iconUrl?: string | null
  url?: string | null
  buttons?: PushButton[]
  origin?: string | null
}

const hostOf = (url: string | null | undefined, origin: string | null | undefined) => {
  const raw = url && /^https?:\/\//i.test(url) ? url : origin

  if (!raw) return 'your-site.com'

  try {
    return new URL(raw).host
  } catch {
    return 'your-site.com'
  }
}

const Icon = ({ src, className }: { src: string | null; className?: string }) =>
  src ? (
     
    <img src={src} alt='' className={cn('bg-muted rounded object-cover', className)} />
  ) : (
    <div className={cn('bg-muted text-muted-foreground flex items-center justify-center rounded', className)}>
      <ImageIcon className='size-1/2' />
    </div>
  )

const BigImage = ({ src }: { src: string | null }) =>
  src ? (
     
    <img src={src} alt='' className='bg-muted aspect-[2/1] w-full object-cover' />
  ) : (
    <div className='bg-muted text-muted-foreground flex aspect-[2/1] w-full items-center justify-center text-xs'>No image</div>
  )

const DesktopCard = ({ p, withImage }: { p: PreviewProps; withImage: boolean }) => {
  const icon = imageSrc(p.iconUrl)
  const img = imageSrc(p.imageUrl)

  return (
    <div className='bg-popover text-popover-foreground w-full max-w-[360px] overflow-hidden rounded-lg border shadow-lg'>
      <div className='text-muted-foreground flex items-center gap-1.5 px-3 pt-2 text-[11px]'>
        <MonitorIcon className='size-3' /> Google Chrome · {hostOf(p.url, p.origin)}
      </div>
      {withImage && img && (
        <div className='mt-2'>
          <BigImage src={img} />
        </div>
      )}
      <div className='flex gap-3 p-3'>
        <div className='min-w-0 flex-1'>
          <div className='truncate text-sm font-semibold'>{p.title || 'Notification title'}</div>
          <div className='text-muted-foreground line-clamp-2 text-xs'>{p.body || 'Your message appears here.'}</div>
        </div>
        <Icon src={icon} className='size-10 shrink-0' />
      </div>
      {(p.buttons?.length ?? 0) > 0 && (
        <div className='grid grid-flow-col border-t'>
          {p.buttons!.map(b => (
            <div key={b.id} className='border-r px-3 py-2 text-center text-xs font-medium last:border-r-0'>
              {b.text || 'Button'}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const AndroidCard = ({ p, withImage }: { p: PreviewProps; withImage: boolean }) => {
  const icon = imageSrc(p.iconUrl)
  const img = imageSrc(p.imageUrl)

  return (
    <div className='bg-card text-card-foreground w-full max-w-[360px] overflow-hidden rounded-2xl border p-3 shadow-lg'>
      <div className='text-muted-foreground flex items-center gap-1.5 text-[11px]'>
        <Icon src={icon} className='size-4 rounded-full' /> Chrome · {hostOf(p.url, p.origin)} · now
      </div>
      <div className='mt-1.5 flex gap-3'>
        <div className='min-w-0 flex-1'>
          <div className='truncate text-sm font-semibold'>{p.title || 'Notification title'}</div>
          <div className='text-muted-foreground line-clamp-3 text-xs'>{p.body || 'Your message appears here.'}</div>
        </div>
        {!withImage && icon && <Icon src={icon} className='size-10 shrink-0 rounded-md' />}
      </div>
      {withImage && img && (
        <div className='mt-2 overflow-hidden rounded-lg'>
          <BigImage src={img} />
        </div>
      )}
      {(p.buttons?.length ?? 0) > 0 && (
        <div className='text-primary mt-2 flex gap-5 text-xs font-semibold uppercase'>
          {p.buttons!.map(b => (
            <span key={b.id}>{b.text || 'Button'}</span>
          ))}
        </div>
      )}
    </div>
  )
}

export const NotificationPreview = (p: PreviewProps) => {
  const [device, setDevice] = useState<'desktop' | 'android' | 'both'>('both')
  const [withImage, setWithImage] = useState(true)
  const hasImage = Boolean(p.imageUrl)

  return (
    <div className='grid gap-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <Tabs value={device} onValueChange={v => setDevice(v as typeof device)}>
          <TabsList>
            <TabsTrigger value='both'>Both</TabsTrigger>
            <TabsTrigger value='desktop'>
              <MonitorIcon /> Desktop
            </TabsTrigger>
            <TabsTrigger value='android'>
              <SmartphoneIcon /> Android
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <label className='flex items-center gap-2 text-sm'>
          <Switch checked={withImage && hasImage} disabled={!hasImage} onCheckedChange={setWithImage} /> Show big image
        </label>
      </div>
      <div className='bg-muted/40 grid justify-items-center gap-5 rounded-lg border border-dashed p-5'>
        {device !== 'android' && (
          <div className='grid w-full justify-items-center gap-1'>
            <span className='text-muted-foreground text-xs'>Desktop Chrome</span>
            <DesktopCard p={p} withImage={withImage} />
          </div>
        )}
        {device !== 'desktop' && (
          <div className='grid w-full justify-items-center gap-1'>
            <span className='text-muted-foreground text-xs'>Android (Chrome)</span>
            <AndroidCard p={p} withImage={withImage} />
          </div>
        )}
      </div>
      <p className='text-muted-foreground text-xs'>
        Approximate: each OS draws its own card. macOS shows no big image; Windows and Android do. Buttons appear on Chrome desktop and Android only.
      </p>
    </div>
  )
}
