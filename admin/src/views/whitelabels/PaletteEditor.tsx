'use client'

import { SelectField, SwitchField } from '@/components/shared/FormField'
import { Input } from '@/components/ui/input'

import PalettePreview from './PalettePreview'
import { TEMPLATE_LABELS, TEMPLATE_PALETTES, TOKEN_LABELS } from './palettes'
import { PALETTE_KEYS, type Palette } from './types'

export type ThemeValue = { template: string; palette: Palette | null }

const HEX = /^#[0-9a-fA-F]{6}$/

/** Every token is #RRGGBB — the backend refuses anything else. */
export const paletteError = (palette: Palette | null) =>
  palette && PALETTE_KEYS.some(k => !HEX.test(palette[k])) ? 'Every colour must be #RRGGBB' : undefined

/**
 * Template + optional custom colours, with a live preview. Custom starts from the chosen template's
 * own colours, so changing one token keeps the rest of the look.
 */
const PaletteEditor = ({ value, onChange, name, logoUrl }: { value: ThemeValue; onChange: (v: ThemeValue) => void; name: string; logoUrl?: string | null }) => {
  const shown = value.palette ?? TEMPLATE_PALETTES[value.template] ?? TEMPLATE_PALETTES.hash_game

  const setToken = (key: keyof Palette, color: string) => onChange({ ...value, palette: { ...shown, [key]: color } })

  return (
    <div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]'>
      <div className='grid content-start gap-4'>
        <SelectField
          id='wl-template'
          label='Colour template'
          value={value.template}
          onChange={template => onChange({ template, palette: value.palette ? { ...(TEMPLATE_PALETTES[template] ?? shown) } : null })}
          options={Object.keys(TEMPLATE_PALETTES).map(k => ({ value: k, label: TEMPLATE_LABELS[k] ?? k }))}
          hint='The player site’s colours. Choose custom colours below to change any of them.'
        />
        <SwitchField
          id='wl-custom'
          label='Custom colours'
          hint='Starts from the template’s colours.'
          checked={Boolean(value.palette)}
          onChange={on => onChange({ ...value, palette: on ? { ...shown } : null })}
        />
        {value.palette && (
          <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
            {PALETTE_KEYS.map(key => (
              <label key={key} className='flex items-center gap-2 text-sm'>
                <input
                  type='color'
                  aria-label={TOKEN_LABELS[key]}
                  className='h-8 w-10 shrink-0 cursor-pointer rounded border bg-transparent'
                  value={HEX.test(shown[key]) ? shown[key] : '#000000'}
                  onChange={e => setToken(key, e.target.value)}
                />
                <span className='min-w-0 flex-1 truncate'>{TOKEN_LABELS[key]}</span>
                <Input
                  className='h-8 w-24 font-mono text-xs'
                  value={shown[key]}
                  maxLength={7}
                  aria-invalid={!HEX.test(shown[key])}
                  onChange={e => setToken(key, e.target.value.trim())}
                />
              </label>
            ))}
          </div>
        )}
      </div>
      <div className='grid content-start gap-2'>
        <span className='text-muted-foreground text-sm'>Preview</span>
        <PalettePreview palette={shown} name={name} logoUrl={logoUrl} />
      </div>
    </div>
  )
}

export default PaletteEditor
