'use client'

import { useEffect } from 'react'

import { UploadIcon, XIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'

export type PickedImage = { type: string; data: string; url: string }

const LOGO_TYPES = ['image/png', 'image/webp', 'image/svg+xml']

/** A poster is a photo: PNG, JPEG or WebP up to 600 KB (the backend's limit). */
export const POSTER = { types: ['image/png', 'image/jpeg', 'image/webp'], maxBytes: 600 * 1024 }

/**
 * One image (logo or square icon) as base64 for admin/whitelabels — the backend checks the bytes
 * again (branding rules). `current` is what is stored now, shown until something new is picked.
 */
const ImageField = ({
  label,
  hint,
  value,
  onChange,
  onError,
  current,
  square,
  types = LOGO_TYPES,
  maxBytes = 256 * 1024
}: {
  label: string
  hint: string
  value: PickedImage | null
  onChange: (image: PickedImage | null) => void
  onError: (message: string) => void
  current?: string | null
  square?: boolean
  types?: string[]
  maxBytes?: number
}) => {
  // The preview's object URL dies with the image it showed.
  useEffect(
    () => () => {
      if (value?.url) URL.revokeObjectURL(value.url)
    },
    [value]
  )

  const pick = (file: File | undefined) => {
    if (!file) return
    if (!types.includes(file.type)) return onError(`${types.map(t => t.split('/')[1].replace('svg+xml', 'SVG').toUpperCase()).join(', ')} only`)
    if (file.size > maxBytes) return onError(`At most ${Math.round(maxBytes / 1024)} KB`)
    const reader = new FileReader()

    reader.onload = () => onChange({ type: file.type, data: String(reader.result).split(',')[1] ?? '', url: URL.createObjectURL(file) })
    reader.readAsDataURL(file)
  }

  const shown = value?.url ?? current

  return (
    <div className='grid gap-2'>
      <span className='text-sm font-medium'>{label}</span>
      <div className='flex flex-wrap items-center gap-3'>
        {shown && (
           
          <img src={shown} alt={`${label} preview`} className={`bg-muted rounded object-contain p-1 ${square ? 'size-10' : 'h-10 max-w-40'}`} />
        )}
        <Button type='button' variant='outline' size='sm' nativeButton={false} render={<label />}>
          <UploadIcon /> {shown ? 'Change' : 'Upload'}
          <input type='file' accept={types.join(',')} className='hidden' onChange={e => pick(e.target.files?.[0])} />
        </Button>
        {value && (
          <Button type='button' variant='ghost' size='sm' onClick={() => onChange(null)}>
            <XIcon /> Remove
          </Button>
        )}
        <span className='text-muted-foreground text-xs'>{hint}</span>
      </div>
    </div>
  )
}

export default ImageField
