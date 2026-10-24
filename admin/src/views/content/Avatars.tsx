'use client'

import { useEffect, useMemo, useState } from 'react'

import { LockIcon, PencilIcon, Trash2Icon, UploadIcon, UserRoundIcon } from 'lucide-react'

import Can from '@/components/shared/Can'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import ErrorState from '@/components/shared/ErrorState'
import FormDialog from '@/components/shared/FormDialog'
import { SelectField, TextField } from '@/components/shared/FormField'
import PageHeader from '@/components/shared/PageHeader'
import StatusBadge from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { check } from '@/lib/validate'
import type { VipLadder } from '../promotions/types'
import type { Avatar } from './types'

/**
 * Avatars players can pick on the site's Edit avatar screen. Each one opens at a VIP level:
 * a player below it sees the picture locked and cannot choose it (the backend refuses it too).
 * Images are stored by the backend and served from `admin/avatars/:id/image`.
 */

/** The backend's limits: PNG, JPEG or WebP, up to 1 MB. */
const MAX_IMAGE_BYTES = 1024 * 1024
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']

/** `/api/v1/admin/avatars/3/image?v=…` (absolute or not) → the admin proxy, so it loads from here. */
const avatarSrc = (a: Avatar) => {
  const m = /\/api\/v1\/(.+)$/.exec(a.url ?? '')

  return m ? `/api/gw/api/v1/${m[1]}` : api.url(`admin/avatars/${a.id}/image`)
}

const fileProblem = (file: File | null, required: boolean) =>
  !file
    ? required
      ? 'Choose an image'
      : undefined
    : !IMAGE_TYPES.includes(file.type)
      ? 'The image must be PNG, JPEG or WebP'
      : file.size > MAX_IMAGE_BYTES
        ? `The image is ${(file.size / 1024).toFixed(0)} KB — the limit is 1 MB`
        : undefined

/** "All players" plus each VIP level of the ladder, by name. */
const useLevelOptions = () => {
  const q = useApi<VipLadder>('user/vip/levels')
  const levels = Array.isArray(q.data?.levels) ? q.data.levels : []

  const name = (level: number) => {
    if (level <= 0) return 'All players'
    const l = levels.find(x => Number(x.level) === level)

    return l ? `VIP ${level}${l.name ? ` — ${l.name}` : ` — ${l.card}`}` : `VIP ${level}`
  }

  const options = [{ value: '0', label: 'All players (level 0)' }, ...levels.filter(l => Number(l.level) > 0).map(l => ({ value: String(l.level), label: name(Number(l.level)) }))]

  return { options, name }
}

/** The chosen file's preview, alive only while it is chosen. */
const usePreview = (file: File | null) => {
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  return preview
}

const ImageInput = ({ id, required, current, file, onFile }: { id: string; required: boolean; current?: string; file: File | null; onFile: (f: File | null) => void }) => {
  const preview = usePreview(file)
  const src = preview ?? current

  return (
    <div className='grid gap-2'>
      <label htmlFor={id} className='text-sm font-medium'>
        Image {required ? '*' : '(leave empty to keep the current one)'}
      </label>
      <span className='text-muted-foreground text-xs'>PNG, JPEG or WebP, up to 1 MB. Square works best — it is shown in a circle.</span>
      <input id={id} type='file' accept='image/png,image/jpeg,image/webp' className='text-sm' onChange={e => onFile(e.target.files?.[0] ?? null)} required={required} />
      {src && (
        <img src={src} alt={preview ? 'The new image' : 'The current image'} className='bg-muted size-24 rounded-full border object-cover' />
      )}
    </div>
  )
}

const UploadAvatar = ({ levels }: { levels: ReturnType<typeof useLevelOptions> }) => {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [form, setForm] = useState({ minLevel: '0', sort: '', enabled: true })

  const onOpenChange = (next: boolean) => {
    if (next) {
      setFile(null)
      setForm({ minLevel: '0', sort: '', enabled: true })
    }

    setOpen(next)
  }

  const upload = useApiMutation({
    // Multipart, as Banners: the file under `image`, the rest as form fields.
    fn: async () => {
      const fd = new FormData()

      fd.set('image', file!)
      fd.set('minLevel', form.minLevel)
      if (form.sort !== '') fd.set('sort', form.sort)
      fd.set('enabled', String(form.enabled))

      return api.upload<Avatar>('admin/avatars', fd)
    },
    invalidate: [['api', 'admin/avatars']],
    success: () => 'Avatar uploaded'
  })

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        <Button>
          <UploadIcon /> Upload avatar
        </Button>
      }
      title='Upload an avatar'
      description='Players at or above the level can choose it; everyone below sees it locked.'
      submitLabel='Upload'
      onSubmit={() => upload.mutateAsync()}
      validate={() => ({
        'av-image': fileProblem(file, true),
        'av-sort': check.number(form.sort, 'Sort order', { integer: true, min: 0, max: 9999, optional: true })
      })}
    >
      <ImageInput id='av-image' required file={file} onFile={setFile} />
      <SelectField id='av-level' label='Opens at' value={form.minLevel} onChange={v => setForm({ ...form, minLevel: v })} options={levels.options} hint='The lowest VIP level that can pick it.' />
      <TextField id='av-sort' label='Sort order' type='number' min={0} max={9999} hint='Lower shows first. Empty puts it last.' value={form.sort} onChange={e => setForm({ ...form, sort: e.target.value })} />
      <label className='flex items-center gap-2 text-sm'>
        <Switch checked={form.enabled} onCheckedChange={enabled => setForm({ ...form, enabled })} /> Shown to players
      </label>
    </FormDialog>
  )
}

const EditAvatar = ({ avatar, levels }: { avatar: Avatar; levels: ReturnType<typeof useLevelOptions> }) => {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const blank = () => ({ minLevel: String(avatar.minLevel ?? 0), sort: String(avatar.sort ?? 0), enabled: avatar.enabled })
  const [form, setForm] = useState(blank)

  const onOpenChange = (next: boolean) => {
    if (next) {
      setFile(null)
      setForm(blank())
    }

    setOpen(next)
  }

  const save = useApiMutation({
    fn: async () => {
      const changes: Record<string, unknown> = {}

      if (Number(form.minLevel) !== avatar.minLevel) changes.minLevel = Number(form.minLevel)
      if (Number(form.sort) !== avatar.sort) changes.sort = Number(form.sort)
      if (form.enabled !== avatar.enabled) changes.enabled = form.enabled
      if (Object.keys(changes).length) await api.patch(`admin/avatars/${avatar.id}`, changes)

      if (file) {
        const fd = new FormData()

        fd.set('image', file)
        await api.upload(`admin/avatars/${avatar.id}/image`, fd, 'PUT')
      }
    },
    invalidate: [['api', 'admin/avatars']],
    success: () => 'Avatar saved'
  })

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        <Button variant='ghost' size='icon-sm' aria-label='Edit avatar'>
          <PencilIcon />
        </Button>
      }
      title='Edit avatar'
      description='Raising the level locks it for players below; a player already wearing it keeps it.'
      submitLabel='Save'
      onSubmit={() => save.mutateAsync()}
      validate={() => ({
        'ave-image': fileProblem(file, false),
        'ave-sort': check.number(form.sort, 'Sort order', { integer: true, min: 0, max: 9999 })
      })}
    >
      <ImageInput id='ave-image' required={false} current={avatarSrc(avatar)} file={file} onFile={setFile} />
      <SelectField id='ave-level' label='Opens at' value={form.minLevel} onChange={v => setForm({ ...form, minLevel: v })} options={levels.options} />
      <TextField id='ave-sort' label='Sort order' type='number' min={0} max={9999} value={form.sort} onChange={e => setForm({ ...form, sort: e.target.value })} />
      <label className='flex items-center gap-2 text-sm'>
        <Switch checked={form.enabled} onCheckedChange={enabled => setForm({ ...form, enabled })} /> Shown to players
      </label>
    </FormDialog>
  )
}

const AvatarCard = ({ avatar, levels }: { avatar: Avatar; levels: ReturnType<typeof useLevelOptions> }) => {
  const setEnabled = useApiMutation({
    fn: (enabled: boolean) => api.patch(`admin/avatars/${avatar.id}`, { enabled }),
    invalidate: [['api', 'admin/avatars']],
    success: (_r, enabled) => (enabled ? 'Avatar shown to players' : 'Avatar hidden')
  })

  const remove = useApiMutation({
    fn: () => api.delete(`admin/avatars/${avatar.id}`),
    invalidate: [['api', 'admin/avatars']],
    success: () => 'Avatar deleted'
  })

  return (
    <div className={`bg-card flex flex-col items-center gap-3 rounded-xl border p-4 ${avatar.enabled ? '' : 'opacity-60'}`}>
      <img
        src={avatarSrc(avatar)}
        alt={`Avatar ${avatar.id}`}
        className='bg-muted size-20 rounded-full border object-cover'
        onError={e => (e.currentTarget.style.visibility = 'hidden')}
      />
      <Badge variant={avatar.minLevel > 0 ? 'secondary' : 'outline'} className='max-w-full truncate'>
        {avatar.minLevel > 0 && <LockIcon />}
        {avatar.minLevel > 0 ? `From ${levels.name(avatar.minLevel)}` : 'All players'}
      </Badge>
      <span className='text-muted-foreground text-xs tabular-nums'>Order {avatar.sort}</span>
      <div className='flex w-full items-center justify-between gap-2'>
        <Can permission='config:write' fallback={<StatusBadge value={avatar.enabled} />}>
          <Switch aria-label='Shown to players' checked={avatar.enabled} disabled={setEnabled.isPending} onCheckedChange={v => setEnabled.mutate(v)} />
        </Can>
        <Can permission='config:write'>
          <div className='flex items-center'>
            <EditAvatar avatar={avatar} levels={levels} />
            <ConfirmDialog
              trigger={
                <Button variant='ghost' size='icon-sm' aria-label='Delete avatar'>
                  <Trash2Icon />
                </Button>
              }
              title='Delete this avatar?'
              description='Players can no longer pick it. Anyone wearing it now goes back to the default picture.'
              confirmLabel='Delete'
              destructive
              onConfirm={() => remove.mutateAsync()}
            />
          </div>
        </Can>
      </div>
    </div>
  )
}

const Avatars = () => {
  const list = useApi<Avatar[]>('admin/avatars', undefined, { retry: false })
  const levels = useLevelOptions()
  const rows = useMemo(() => (Array.isArray(list.data) ? [...list.data].sort((a, b) => a.minLevel - b.minLevel || a.sort - b.sort || a.id - b.id) : []), [list.data])

  return (
    <div>
      <PageHeader
        title='Avatars'
        description='Profile pictures players choose from on the site. Each opens at a VIP level — players below it see the avatar locked until they reach that level.'
        actions={
          <Can permission='config:write'>
            <UploadAvatar levels={levels} />
          </Can>
        }
      />
      {list.error && !list.data ? (
        <ErrorState error={list.error} title='Could not load the avatars' />
      ) : list.isLoading ? (
        <div className='grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6'>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className='h-48 rounded-xl' />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className='text-muted-foreground flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-sm'>
          <UserRoundIcon className='size-6' />
          No avatars yet. Players keep the default picture until one is uploaded.
        </div>
      ) : (
        <div className='grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6'>
          {rows.map(a => (
            <AvatarCard key={a.id} avatar={a} levels={levels} />
          ))}
        </div>
      )}
    </div>
  )
}

export default Avatars
