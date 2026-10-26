'use client'

import { useEffect, useMemo, useState } from 'react'

import { ImageIcon, Trash2Icon, UploadIcon } from 'lucide-react'

import Can from '@/components/shared/Can'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import FormDialog from '@/components/shared/FormDialog'
import PageHeader from '@/components/shared/PageHeader'
import StatusBadge from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import type { ProviderSetting } from './types'

const LIST = 'admin/casino/games/provider-settings'

/**
 * The lobby's providers and the site's say over them (casino-service, migration 067).
 * Switching one off takes its games out of the lobby, search and stats, and refuses a
 * launch. A logo replaces the provider's name on the site; without one the name shows.
 *
 * The preview reads the ADMIN logo route, which serves a switched-off provider's logo too;
 * the site's own URL (`logoUrl`) stops serving it while the provider is off.
 */
const logoSrc = (p: ProviderSetting) => api.url(`${LIST}/${encodeURIComponent(p.name)}/logo`, { v: p.logoUpdatedAt ?? '' })

const label = (p: ProviderSetting) => p.displayName ?? p.name

const UploadLogo = ({ provider }: { provider: ProviderSetting }) => {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)

  // Or an image URL: the platform fetches it (public https only) and checks it like an upload.
  const [url, setUrl] = useState('')
  const urlOk = /^https:\/\/\S+$/i.test(url.trim())

  // The chosen file's preview lives only while it is chosen.
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  const onOpenChange = (next: boolean) => {
    if (next) {
      setFile(null)
      setUrl('')
    }

    setOpen(next)
  }

  const upload = useApiMutation({
    fn: () => {
      if (!file && urlOk) return api.put<ProviderSetting>(`${LIST}/${encodeURIComponent(provider.name)}/logo-url`, { url: url.trim() })

      const fd = new FormData()

      if (file) fd.set('image', file)

      return api.upload<ProviderSetting>(`${LIST}/${encodeURIComponent(provider.name)}/logo`, fd, 'PUT')
    },
    invalidate: [['api', LIST]],
    success: `Logo saved for ${label(provider)}`
  })

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        <Button variant='ghost' size='sm'>
          <UploadIcon /> {provider.hasLogo ? 'Replace' : 'Upload logo'}
        </Button>
      }
      title={`${provider.hasLogo ? 'Replace' : 'Upload'} the ${label(provider)} logo`}
      description='A file or an https image URL. PNG, JPEG or WebP, up to 1 MB. A wide logo on a transparent background reads best (about 240×80). SVG is not accepted: it can carry script.'
      submitLabel='Upload'
      onSubmit={() => upload.mutateAsync()}
      validate={() => ({
        'p-logo': !file && urlOk
          ? undefined
          : !file
          ? url.trim() ? 'The URL must start with https://' : 'Choose an image file or paste an image URL'
          : !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
            ? 'The logo must be a PNG, JPEG or WebP image'
            : file.size > 1024 * 1024
              ? `The image is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 1 MB`
              : undefined
      })}
    >
      <div className='grid gap-2'>
        <label htmlFor='p-logo' className='text-sm font-medium'>
          Image *
        </label>
        <input id='p-logo' type='file' accept='image/png,image/jpeg,image/webp' className='text-sm' onChange={e => setFile(e.target.files?.[0] ?? null)} />
        <label htmlFor='p-logo-url' className='text-sm font-medium'>
          Or image URL
        </label>
        <Input id='p-logo-url' type='url' inputMode='url' placeholder='https://…/logo.png' value={url} disabled={!!file} onChange={e => setUrl(e.target.value)} />
        {file && !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) && <p role='alert' className='text-destructive text-sm'>The logo must be a PNG, JPEG or WebP image</p>}
        {file && file.size > 1024 * 1024 && <p role='alert' className='text-destructive text-sm'>The image is larger than 1 MB</p>}
        {(preview || urlOk || provider.hasLogo) && (
          <div className='grid gap-1'>
            <span className='text-muted-foreground text-xs'>{preview || urlOk ? 'The new logo' : 'The current logo'}</span>
            <img
              src={preview ?? (urlOk ? url.trim() : logoSrc(provider))}
              alt={preview || urlOk ? 'The new logo' : 'The current logo'}
              className='h-24 w-full rounded border bg-neutral-900 object-contain p-3'
            />
          </div>
        )}
      </div>
    </FormDialog>
  )
}

const RemoveLogo = ({ provider }: { provider: ProviderSetting }) => {
  const remove = useApiMutation({
    fn: () => api.delete(`${LIST}/${encodeURIComponent(provider.name)}/logo`),
    invalidate: [['api', LIST]],
    success: `Logo removed for ${label(provider)}`
  })

  return (
    <ConfirmDialog
      trigger={
        <Button variant='ghost' size='sm' aria-label={`Remove the ${label(provider)} logo`}>
          <Trash2Icon /> Remove logo
        </Button>
      }
      title={`Remove the ${label(provider)} logo?`}
      description='The site shows the provider’s name in its place until a new logo is uploaded.'
      confirmLabel='Remove'
      destructive
      onConfirm={() => remove.mutateAsync()}
    />
  )
}

const Providers = () => {
  const list = useApi<ProviderSetting[]>(LIST, undefined, { retry: false })
  const [filter, setFilter] = useState('')

  const setEnabled = useApiMutation({
    fn: (v: { name: string; enabled: boolean }) => api.patch(`${LIST}/${encodeURIComponent(v.name)}`, { enabled: v.enabled }),
    invalidate: [['api', LIST], ['api', 'admin/casino/games/providers']], // The provider switch is shown here only.
    success: (_r, v) => `${v.name} is now ${v.enabled ? 'on' : 'off'} in the lobby`
  })

  const needle = filter.trim().toLowerCase()
  const rows = (list.data ?? []).filter(p => !needle || p.name.toLowerCase().includes(needle) || p.displayName?.toLowerCase().includes(needle))

  const columns: Column<ProviderSetting>[] = [
    {
      key: 'logo',
      header: 'Logo',
      cell: p =>
        p.hasLogo ? (
          <img src={logoSrc(p)} alt={`${label(p)} logo`} className='h-10 w-28 rounded bg-neutral-900 object-contain p-1' onError={e => (e.currentTarget.style.visibility = 'hidden')} />
        ) : (
          <span className='text-muted-foreground flex h-10 w-28 items-center justify-center gap-1 rounded border border-dashed text-xs'>
            <ImageIcon className='size-3.5' /> name only
          </span>
        )
    },
    {
      key: 'name',
      header: 'Provider',
      cell: p => (
        <span className='block'>
          <span className='block text-sm font-medium'>{label(p)}</span>
          {p.displayName && <span className='text-muted-foreground block font-mono text-xs'>{p.name}</span>}
        </span>
      )
    },
    { key: 'games', header: 'Games', align: 'right', cell: p => <span className='tabular-nums'>{p.games.toLocaleString()}</span> },
    {
      key: 'enabled',
      header: 'In lobby',
      cell: p => (
        <Can permission='casino:manage' fallback={<StatusBadge value={p.enabled} />}>
          <Switch
            checked={p.enabled}
            disabled={setEnabled.isPending}
            aria-label={`${label(p)} in the lobby`}
            onCheckedChange={enabled => setEnabled.mutate({ name: p.name, enabled })}
          />
        </Can>
      )
    },
    { key: 'at', header: 'Updated', cell: p => (p.updatedAt ? <DateTime value={p.updatedAt} relative /> : <span className='text-muted-foreground'>—</span>) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: p => (
        <Can permission='casino:manage'>
          <span className='flex justify-end gap-1'>
            <UploadLogo provider={p} />
            {p.hasLogo && <RemoveLogo provider={p} />}
          </span>
        </Can>
      )
    }
  ]

  return (
    <div>
      <PageHeader
        title='Providers'
        description='The game providers in the casino lobby. Switch one off to take every one of its games off the site (lobby, search and launch); upload a logo to show it instead of the name.'
        actions={<Input placeholder='Filter…' className='w-48' value={filter} onChange={e => setFilter(e.target.value)} />}
      />
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={p => p.key}
        loading={list.isLoading}
        fetching={list.isFetching}
        error={list.error}
        emptyMessage={needle ? `No provider matches “${filter}”.` : 'No providers in the catalogue yet. Run the game sync on the backend first.'}
      />
    </div>
  )
}

export default Providers
