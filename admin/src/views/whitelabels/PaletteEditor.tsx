'use client'

import { SelectField, SwitchField } from '@/components/shared/FormField'
import { Input } from '@/components/ui/input'

import PalettePreview from './PalettePreview'
import { ICON_LABELS, TEMPLATE_LABELS, TEMPLATE_PALETTES, TOKEN_LABELS, iconColours } from './palettes'
import { ICON_KEYS, PALETTE_KEYS, type IconKey, type Palette, type PaletteKey } from './types'

export type ThemeValue = { template: string; palette: Palette | null }

const HEX = /^#[0-9a-fA-F]{6}$/

/** Every token is #RRGGBB — the backend refuses anything else. */
export const paletteError = (palette: Palette | null) =>
  palette && (PALETTE_KEYS.some(k => !HEX.test(palette[k])) || ICON_KEYS.some(k => palette[k] !== undefined && !HEX.test(palette[k] as string)))
    ? 'Every colour must be #RRGGBB'
    : undefined

/** One colour: a picker, its name and its #RRGGBB text. */
export const ColourRow = ({ label, color, onChange }: { label: string; color: string; onChange: (color: string) => void }) => (
  <label className='flex items-center gap-2 text-sm'>
    <input
      type='color'
      aria-label={label}
      className='h-8 w-10 shrink-0 cursor-pointer rounded border bg-transparent'
      value={HEX.test(color) ? color : '#000000'}
      onChange={e => onChange(e.target.value)}
    />
    <span className='min-w-0 flex-1 truncate'>{label}</span>
    <Input className='h-8 w-24 font-mono text-xs' value={color} maxLength={7} aria-invalid={!HEX.test(color)} onChange={e => onChange(e.target.value.trim())} />
  </label>
)

/**
 * Template + optional custom colours, with a live preview. Custom starts from the chosen template's
 * own colours, so changing one token keeps the rest of the look.
 */
const PaletteEditor = ({ value, onChange, name, logoUrl }: { value: ThemeValue; onChange: (v: ThemeValue) => void; name: string; logoUrl?: string | null }) => {
  const shown = value.palette ?? TEMPLATE_PALETTES[value.template] ?? TEMPLATE_PALETTES.hash_game

  const icons = iconColours(shown)

  const setToken = (key: keyof Palette, color: string) => onChange({ ...value, palette: { ...shown, [key]: color } })

  /** Back to following the text / brand colours. */
  const resetIcons = () => {
    if (!value.palette) return
    const next = { ...value.palette }

    ICON_KEYS.forEach(k => delete next[k])
    onChange({ ...value, palette: next })
  }

  const row = (key: PaletteKey | IconKey, label: string, color: string) => <ColourRow key={key} label={label} color={color} onChange={c => setToken(key, c)} />

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
          <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>{PALETTE_KEYS.map(key => row(key, TOKEN_LABELS[key], shown[key]))}</div>
        )}
        {value.palette && (
          <div className='grid gap-2'>
            <div className='flex items-center justify-between gap-2'>
              <div>
                <div className='text-sm font-medium'>Icon colours</div>
                <div className='text-muted-foreground text-xs'>Sidebar, header and menu icons. Unchanged, they follow Text and Brand colour.</div>
              </div>
              {ICON_KEYS.some(k => value.palette?.[k]) && (
                <button type='button' className='text-primary shrink-0 text-xs hover:underline' onClick={resetIcons}>
                  Reset icons
                </button>
              )}
            </div>
            <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>{ICON_KEYS.map(key => row(key, ICON_LABELS[key], icons[key]))}</div>
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
