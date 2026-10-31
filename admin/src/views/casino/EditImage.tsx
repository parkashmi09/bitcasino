'use client'

import { useEffect, useMemo, useState } from 'react'

import { ImageIcon, LinkIcon, UploadIcon } from 'lucide-react'

import FormDialog from '@/components/shared/FormDialog'
import { TextField } from '@/components/shared/FormField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useApiMutation } from '@/hooks/use-api'
import { API_V1, api } from '@/lib/api/client'
import { check } from '@/lib/validate'
import type { GisGame } from './types'

/** Uploaded art is a platform path (`/api/v1/casino/games/image/…`); the admin reaches it through its `/api/gw` proxy. */
export const artSrc = (src?: string | null) => (src?.startsWith('/api/v1/') ? `${API_V1}${src.slice('/api/v1'.length)}` : src || null)

/** The upload route's own limit (casino service LOGO_MAX_BYTES). */
const MAX_BYTES = 1024 * 1024

/** A lobby tile's image, edited from the curated lists (Lobby curation, Vendor/Type Priority): an image URL, or a file uploaded to the platform. */
export const EditImage = ({ game, onSaved }: { game: Pick<GisGame, 'uuid' | 'name' | 'image'>; onSaved?: () => void }) => {
  const [mode, setMode] = useState<'url' | 'file'>('url')
  const [image, setImage] = useState(game.image?.startsWith('/api/') ? '' : (game.image ?? ''))
  const [file, setFile] = useState<File | null>(null)
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])

  const invalidate = [['api', 'admin/casino/games/catalogue/search'], ['api', 'admin/casino/games/vendor-search'], ['api', 'admin/casino/games/type-search']]
  const path = `admin/casino/games/catalogue/${encodeURIComponent(game.uuid)}`

  const save = useApiMutation({
    fn: () => {
      if (mode === 'url') return api.put(`${path}/image`, { image })

      const form = new FormData()

      form.append('image', file as File)

      return api.upload(`${path}/image-file`, form, 'PUT')
    },
    invalidate,
    success: 'Image updated',
    onSuccess: () => onSaved?.()
  })

  const shown = mode === 'url' ? image || null : file ? preview : artSrc(game.image)

  return (
    <FormDialog
      trigger={
        <Button size='sm' variant='ghost'>
          <ImageIcon /> Image
        </Button>
      }
      title={`Tile image — ${game.name}`}
      description='Paste an image URL, or upload a PNG, JPEG or WebP file (up to 1 MB).'
      onSubmit={() => save.mutateAsync()}
      validate={() =>
        mode === 'url'
          ? { img: check.url(image, 'Image URL') || check.length(image, 'Image URL', { max: 2048 }) }
          : { file: !file ? 'Choose an image file' : file.size > MAX_BYTES ? 'The file is larger than 1 MB' : undefined }
      }
    >
      <div className='flex gap-2'>
        <Button type='button' size='sm' variant={mode === 'url' ? 'default' : 'outline'} onClick={() => setMode('url')}>
          <LinkIcon /> Image URL
        </Button>
        <Button type='button' size='sm' variant={mode === 'file' ? 'default' : 'outline'} onClick={() => setMode('file')}>
          <UploadIcon /> Upload file
        </Button>
      </div>
      {mode === 'url' ? (
        <TextField id='img' label='Image URL' required value={image} onChange={e => setImage(e.target.value)} />
      ) : (
        <div className='grid gap-2'>
          <Label htmlFor='file'>Image file</Label>
          <Input id='file' type='file' accept='image/png,image/jpeg,image/webp' onChange={e => setFile(e.target.files?.[0] ?? null)} />
        </div>
      )}
      {shown && <img src={shown} alt='' className='max-h-40 rounded object-contain' />}
    </FormDialog>
  )
}
