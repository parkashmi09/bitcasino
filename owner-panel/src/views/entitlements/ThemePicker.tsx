'use client'

/**
 * rainbet: Features & plan → Template. Each theme is a swatch card; clicking one opens a preview of
 * the player site in its colours, with "Use this theme". The owner's own themes can be added
 * (three colours, the rest derived, every derived colour overridable), edited and deleted. Own
 * themes are saved in the entitlements document as `palettes` (lib/entitlements/palettes); the
 * player site and the admin recolour from them.
 */

import { useState } from 'react'

import { CheckIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { PaletteColours } from '@/configs/builtinPalettes'
import { TEMPLATE_CATALOGUE } from '@/configs/templateCatalogue'
import { MAX_LABEL, MAX_PALETTES, type OwnerPalette } from '@/lib/entitlements/palettes'
import { coloursOf, derivePalette, isHex } from '@/lib/themeColours'
import { cn } from '@/lib/utils'

const c = (hex: string) => `#${hex}`

/** A stand-in game tile: a gradient in one of the theme's colours. */
const Tile = ({ from, to, win, p }: { from: string; to: string; win: string; p: PaletteColours }) => (
  <div className='flex min-w-0 flex-1 flex-col gap-1'>
    <div className='h-20 rounded-md' style={{ background: `linear-gradient(160deg, ${c(from)}, ${c(to)})` }} />
    <span className='truncate text-[10px]' style={{ color: c(p.muted) }}>
      Player
    </span>
    <span className='text-[10px] font-semibold' style={{ color: c(p.secondary) }}>
      {win}
    </span>
  </div>
)

const NavItem = ({ p, label, active = false }: { p: PaletteColours; label: string; active?: boolean }) => (
  <div
    className='flex items-center gap-2 rounded-md px-2 py-1.5'
    style={active ? { backgroundColor: c(p.border), color: c(p.fg) } : { color: c(p.muted) }}
  >
    <span className='size-3 rounded-sm' style={{ backgroundColor: active ? c(p.accent) : c(p.input) }} />
    {label}
  </div>
)

/** The player site's home page in the theme's colours: header, sidebar, hero, live wins. */
export const SitePreview = ({ colours: p }: { colours: PaletteColours }) => (
  <div
    aria-hidden
    className='flex h-[340px] overflow-hidden rounded-lg border text-xs select-none'
    style={{ backgroundColor: c(p.bg), borderColor: c(p.border), color: c(p.fg) }}
  >
    <aside className='flex w-40 shrink-0 flex-col gap-3 border-r p-3' style={{ backgroundColor: c(p.card), borderColor: c(p.border) }}>
      <div className='flex rounded-md p-0.5' style={{ backgroundColor: c(p.bg) }}>
        <span className='flex-1 rounded py-1 text-center font-semibold' style={{ backgroundColor: c(p.accent), color: c(p.onAccent) }}>
          Casino
        </span>
        <span className='flex-1 py-1 text-center' style={{ color: c(p.muted) }}>
          Sports
        </span>
      </div>
      <div className='flex flex-col gap-0.5'>
        <NavItem p={p} label='Home' active />
        <NavItem p={p} label='Favorites' />
        <NavItem p={p} label='Recently Played' />
        <NavItem p={p} label='Slots' />
        <NavItem p={p} label='Live Casino' />
      </div>
    </aside>

    <div className='flex min-w-0 flex-1 flex-col'>
      <header className='flex h-12 shrink-0 items-center gap-2 border-b px-4' style={{ backgroundColor: c(p.card), borderColor: c(p.border) }}>
        <span className='text-sm font-bold italic'>Rainbet</span>
        <span className='ml-auto rounded-md px-3 py-1.5' style={{ backgroundColor: c(p.border) }}>
          Login
        </span>
        <span className='rounded-md px-3 py-1.5 font-semibold' style={{ backgroundColor: c(p.accent), color: c(p.onAccent) }}>
          Register
        </span>
      </header>

      <main className='flex flex-1 flex-col gap-3 p-4'>
        <div className='flex gap-3'>
          <div className='flex flex-1 flex-col gap-2 rounded-lg border p-3' style={{ backgroundColor: c(p.card), borderColor: c(p.border) }}>
            <span className='text-sm font-semibold'>Welcome back!</span>
            <span style={{ color: c(p.muted) }}>$1,250.00 / $4,000.00 wagered</span>
            <span className='h-1.5 overflow-hidden rounded-full' style={{ backgroundColor: c(p.input) }}>
              <span className='block h-full w-1/3 rounded-full' style={{ backgroundColor: c(p.accent) }} />
            </span>
            <span className='mt-auto w-fit rounded-md px-3 py-1.5 font-semibold' style={{ backgroundColor: c(p.secondary), color: c(p.onSecondary) }}>
              Deposit
            </span>
          </div>
          <div className='flex w-2/5 flex-col justify-end rounded-lg p-3' style={{ background: `linear-gradient(160deg, ${c(p.border)}, ${c(p.card)})` }}>
            <span className='rounded-md px-2 py-1 font-semibold' style={{ backgroundColor: c(p.accent), color: c(p.onAccent) }}>
              Casino →
            </span>
          </div>
        </div>

        <div className='flex items-center gap-2'>
          <span className='rounded-md px-2 py-1' style={{ backgroundColor: c(p.border) }}>
            <span className='mr-1 inline-block size-1.5 rounded-full' style={{ backgroundColor: c(p.secondary) }} />
            Live Wins
          </span>
        </div>
        <div className='flex gap-2'>
          <Tile p={p} from={p.accent} to={p.card} win='$66.68' />
          <Tile p={p} from={p.secondary} to={p.card} win='$5.52' />
          <Tile p={p} from={p.input} to={p.bg} win='$10.00' />
          <Tile p={p} from={p.accent} to={p.border} win='$1.52' />
          <Tile p={p} from={p.secondary} to={p.border} win='$3.66' />
        </div>
      </main>
    </div>
  </div>
)

/** The theme's colours as a strip: background, panel, border, text, accent, secondary. */
const Swatch = ({ colours: p }: { colours: PaletteColours }) => (
  <div className='flex h-16 overflow-hidden rounded-md border' style={{ borderColor: c(p.border) }}>
    <span className='flex flex-[3] items-end gap-1 p-2' style={{ backgroundColor: c(p.bg) }}>
      <span className='h-5 w-9 rounded' style={{ backgroundColor: c(p.accent) }} />
      <span className='h-5 w-9 rounded' style={{ backgroundColor: c(p.secondary) }} />
    </span>
    <span className='flex-1' style={{ backgroundColor: c(p.card) }} />
    <span className='flex-1' style={{ backgroundColor: c(p.border) }} />
    <span className='flex-1' style={{ backgroundColor: c(p.fg) }} />
  </div>
)

const ThemeCard = ({
  label,
  colours,
  selected,
  saved,
  onOpen
}: {
  label: string
  colours: PaletteColours
  selected: boolean
  saved: boolean
  onOpen: () => void
}) => (
  <button
    type='button'
    onClick={onOpen}
    className={cn(
      'bg-card flex flex-col gap-3 rounded-xl border p-3 text-left transition-colors',
      selected ? 'border-primary ring-primary/30 ring-2' : 'hover:border-foreground/30'
    )}
  >
    <Swatch colours={colours} />
    <span className='flex items-center justify-between gap-2'>
      <span className='truncate font-medium'>{label}</span>
      {selected ? (
        <Badge className='gap-1'>
          <CheckIcon className='size-3' /> {saved ? 'Active' : 'Selected'}
        </Badge>
      ) : saved ? (
        <Badge variant='outline'>Current</Badge>
      ) : null}
    </span>
  </button>
)

/** One colour: swatch picker + hex text. */
const ColourField = ({ label, value, onChange, onReset }: { label: string; value: string; onChange: (hex: string) => void; onReset?: () => void }) => {
  const [text, setText] = useState(value)
  const [last, setLast] = useState(value)

  if (value !== last) {
    setLast(value)
    setText(value)
  }

  return (
    <label className='flex flex-col gap-1 text-sm'>
      <span className='flex items-center justify-between'>
        {label}
        {onReset && (
          <button type='button' className='text-muted-foreground text-xs underline' onClick={onReset}>
            auto
          </button>
        )}
      </span>
      <span className='flex items-center gap-2'>
        <input type='color' value={`#${value}`} onChange={e => onChange(e.target.value.slice(1).toLowerCase())} className='h-9 w-11 shrink-0 cursor-pointer rounded border bg-transparent p-0.5' />
        <Input
          value={text}
          maxLength={7}
          className='font-mono'
          onChange={e => {
            const v = e.target.value.replace(/^#/, '').toLowerCase()

            setText(v)
            if (isHex(v)) onChange(v)
          }}
        />
      </span>
    </label>
  )
}

const ADVANCED: { key: keyof PaletteColours; label: string }[] = [
  { key: 'card', label: 'Panels' },
  { key: 'border', label: 'Borders & tabs' },
  { key: 'input', label: 'Inputs' },
  { key: 'fg', label: 'Text' },
  { key: 'muted', label: 'Muted text' },
  { key: 'onAccent', label: 'Text on accent' },
  { key: 'onSecondary', label: 'Text on secondary' }
]

const slug = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 30) || 'theme'

const ThemeEditor = ({ initial, keys, onSave, onCancel }: { initial?: OwnerPalette; keys: string[]; onSave: (p: OwnerPalette) => void; onCancel: () => void }) => {
  const start = initial?.colours ?? derivePalette('0c83e4', '3bbf57', '0f1328')
  const [label, setLabel] = useState(initial?.label ?? '')
  const [base, setBase] = useState({ accent: start.accent, secondary: start.secondary, bg: start.bg })

  // Advanced colours the owner set by hand; everything else follows the three main colours.
  const [overrides, setOverrides] = useState<Partial<PaletteColours>>(() => {
    if (!initial) return {}
    const derived = derivePalette(start.accent, start.secondary, start.bg)

    return Object.fromEntries(ADVANCED.filter(a => start[a.key] !== derived[a.key]).map(a => [a.key, start[a.key]]))
  })

  const colours: PaletteColours = { ...derivePalette(base.accent, base.secondary, base.bg), ...overrides }
  const name = label.trim()

  const save = () => {
    let key = initial?.key ?? `custom_${slug(name)}`

    for (let n = 2; !initial && keys.includes(key); n++) key = `custom_${slug(name)}_${n}`
    onSave({ key, label: name, colours })
  }

  return (
    <Card className='shadow-none'>
      <CardHeader>
        <CardTitle>{initial ? `Edit “${initial.label}”` : 'Add theme'}</CardTitle>
        <CardDescription>
          Pick the three main colours; panels, borders, inputs and text are worked out from the background. Open Advanced to set
          any of them yourself. Saved with the rest of Features &amp; plan (Review and save, below).
        </CardDescription>
      </CardHeader>
      <CardContent className='grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]'>
        <div className='flex flex-col gap-4'>
          <label className='flex flex-col gap-1 text-sm'>
            Theme name
            <Input value={label} maxLength={MAX_LABEL} placeholder='e.g. Midnight Gold' onChange={e => setLabel(e.target.value)} />
          </label>
          <div className='grid gap-3 sm:grid-cols-3'>
            <ColourField label='Accent' value={base.accent} onChange={v => setBase(b => ({ ...b, accent: v }))} />
            <ColourField label='Secondary' value={base.secondary} onChange={v => setBase(b => ({ ...b, secondary: v }))} />
            <ColourField label='Background' value={base.bg} onChange={v => setBase(b => ({ ...b, bg: v }))} />
          </div>
          <p className='text-muted-foreground text-xs'>
            Accent: main buttons, tabs and links. Secondary: Register, Wallet, Deposit and win amounts. Background: the page ground.
          </p>
          <details className='rounded-md border p-3'>
            <summary className='cursor-pointer text-sm font-medium'>Advanced</summary>
            <div className='mt-3 grid gap-3 sm:grid-cols-2'>
              {ADVANCED.map(a => (
                <ColourField
                  key={a.key}
                  label={a.label}
                  value={colours[a.key]}
                  onChange={v => setOverrides(o => ({ ...o, [a.key]: v }))}
                  onReset={
                    overrides[a.key]
                      ? () =>
                          setOverrides(o => {
                            const next = { ...o }

                            delete next[a.key]

                            return next
                          })
                      : undefined
                  }
                />
              ))}
            </div>
          </details>
          <div className='flex gap-2'>
            <Button type='button' onClick={save} disabled={!name}>
              {initial ? 'Update theme' : 'Add theme'}
            </Button>
            <Button type='button' variant='outline' onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
        <SitePreview colours={colours} />
      </CardContent>
    </Card>
  )
}

type Option = { key: string; label: string; colours: PaletteColours; own: boolean }

const ThemePicker = ({
  template,
  saved,
  palettes,
  onPick,
  onPalettes
}: {
  template: string | undefined
  saved: string | undefined
  palettes: OwnerPalette[]
  onPick: (key: string) => void
  onPalettes: (next: OwnerPalette[]) => void
}) => {
  // The theme whose preview is open, and the editor: null = closed, 'new' = Add theme, a key = editing.
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

  const options: Option[] = [
    ...TEMPLATE_CATALOGUE.map(t => ({ key: t.key, label: t.label, colours: coloursOf(t.key), own: false })),
    ...palettes.map(p => ({ key: p.key, label: p.label, colours: p.colours, own: true }))
  ]

  const open = options.find(o => o.key === previewing)
  const inUse = (key: string) => template === key || saved === key

  return (
    <div className='flex flex-col gap-4'>
      {editing && (
        <ThemeEditor
          key={editing}
          initial={palettes.find(p => p.key === editing)}
          keys={palettes.map(p => p.key)}
          onCancel={() => setEditing(null)}
          onSave={p => {
            onPalettes(palettes.some(o => o.key === p.key) ? palettes.map(o => (o.key === p.key ? p : o)) : [...palettes, p])
            onPick(p.key)
            setEditing(null)
          }}
        />
      )}

      <div className='grid gap-3 sm:grid-cols-3 xl:grid-cols-5'>
        {options.map(o => (
          <ThemeCard key={o.key} label={o.label} colours={o.colours} selected={template === o.key} saved={saved === o.key} onOpen={() => setPreviewing(o.key)} />
        ))}
        {palettes.length < MAX_PALETTES && (
          <button
            type='button'
            onClick={() => setEditing('new')}
            className='text-muted-foreground hover:border-foreground/30 hover:text-foreground flex min-h-28 flex-col items-center justify-center gap-1 rounded-xl border border-dashed p-3'
          >
            <PlusIcon className='size-5' />
            <span className='font-medium'>Add theme</span>
          </button>
        )}
      </div>

      <Dialog open={!!open} onOpenChange={o => !o && setPreviewing(null)}>
        <DialogContent className='sm:max-w-3xl'>
          {open && (
            <>
              <DialogHeader>
                <DialogTitle>{open.label}</DialogTitle>
                <DialogDescription>
                  The player site in this theme. Layout, fonts and pictures stay; colours, icons and buttons follow it.
                </DialogDescription>
              </DialogHeader>
              <SitePreview colours={open.colours} />
              <DialogFooter className='gap-2 sm:justify-between'>
                <div className='flex gap-2'>
                  {open.own && (
                    <>
                      <Button
                        type='button'
                        variant='outline'
                        onClick={() => {
                          setEditing(open.key)
                          setPreviewing(null)
                        }}
                      >
                        <PencilIcon /> Edit
                      </Button>
                      <Button
                        type='button'
                        variant='ghost'
                        disabled={inUse(open.key)}
                        title={inUse(open.key) ? 'Pick another template first' : undefined}
                        onClick={() => {
                          onPalettes(palettes.filter(p => p.key !== open.key))
                          setPreviewing(null)
                        }}
                      >
                        <Trash2Icon /> Delete
                      </Button>
                    </>
                  )}
                </div>
                <Button
                  type='button'
                  disabled={template === open.key}
                  onClick={() => {
                    onPick(open.key)
                    setPreviewing(null)
                  }}
                >
                  {template === open.key ? 'In use' : 'Use this theme'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default ThemePicker
