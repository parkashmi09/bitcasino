'use client'

import { useState } from 'react'

import { Loader2Icon } from 'lucide-react'

import { SelectField } from '@/components/shared/FormField'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'

import { ColourRow, paletteError } from './PaletteEditor'
import { TEMPLATE_LABELS, TEMPLATE_PALETTES, TOKEN_LABELS } from './palettes'
import { PALETTE_KEYS, type AdminTheme, type Palette, type WhitelabelDetail as Detail } from './types'

type Mode = 'player' | 'default' | 'custom'

const MODES: Array<{ value: Mode; label: string }> = [
  { value: 'player', label: 'Same as player site' },
  { value: 'default', label: 'Default admin colours' },
  { value: 'custom', label: 'Custom colours' }
]

const HINTS: Record<Mode, string> = {
  player: 'The admin panel uses the player site’s colours (template or custom), and changes with them.',
  default: 'The admin panel keeps its own built-in colours, whatever the player site uses.',
  custom: 'The admin panel gets colours of its own, apart from the player site.'
}

/** The admin's colour tokens that a palette sets (components/shared/WhitelabelTheme). */
const ADMIN_TOKENS = PALETTE_KEYS.filter(k => k !== 'live' && k !== 'hi' && k !== 'lo' && k !== 'accent')

/** A small mock of the admin panel in these colours: sidebar, header, a card, a table row, a button. */
const AdminPreview = ({ palette: p, name }: { palette: Palette; name: string }) => (
  <div className='overflow-hidden rounded-lg border text-[11px] leading-tight' style={{ background: p.bg, color: p.text }} aria-label='Admin colour preview'>
    <div className='flex'>
      <div className='hidden w-28 shrink-0 space-y-1 p-2 sm:block' style={{ background: p.bg, borderRight: `1px solid ${p.border}` }}>
        <div className='mb-2 px-2 font-semibold' style={{ color: p.primary }}>
          {name || 'Admin'}
        </div>
        {['Dashboard', 'Players', 'Finance', 'Reports'].map((item, i) => (
          <div key={item} className='rounded px-2 py-1' style={i === 0 ? { background: p.primary, color: p.ink } : { color: p.muted }}>
            {item}
          </div>
        ))}
      </div>
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-2 px-3 py-2' style={{ borderBottom: `1px solid ${p.border}` }}>
          <span className='rounded px-2 py-1' style={{ background: p.s2, color: p.muted, border: `1px solid ${p.border}` }}>
            Search…
          </span>
          <span className='ml-auto size-5 rounded-full' style={{ background: p.s2 }} />
        </div>
        <div className='space-y-2 p-3'>
          <div className='rounded-lg p-3' style={{ background: p.s1, border: `1px solid ${p.border}` }}>
            <div className='flex items-center'>
              <div>
                <div className='text-sm font-semibold'>Deposits today</div>
                <div style={{ color: p.muted }}>12 approved · 3 pending</div>
              </div>
              <span className='ml-auto rounded px-2 py-1 font-semibold' style={{ background: p.primary, color: p.ink }}>
                Approve
              </span>
            </div>
          </div>
          <div className='rounded-lg' style={{ background: p.s1, border: `1px solid ${p.border}` }}>
            {['player_01', 'player_02'].map((u, i) => (
              <div key={u} className='flex px-3 py-1.5' style={i ? { borderTop: `1px solid ${p.border}` } : undefined}>
                <span>{u}</span>
                <span className='ml-auto' style={{ color: p.muted }}>
                  ₹ 5,000
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  </div>
)

const modeOf = (t: AdminTheme | null): Mode => (t ? t.mode : 'player')

/**
 * The copy's ADMIN PANEL colours, chosen apart from its player site's: follow the player site (the
 * default), the admin's own built-in colours, or a custom palette. Saved to a live copy at once.
 */
const AdminColours = ({ wl, invalidate }: { wl: Detail; invalidate: string[][] }) => {
  const [mode, setMode] = useState<Mode>(() => modeOf(wl.adminTheme))
  const [start, setStart] = useState<string>(wl.template in TEMPLATE_PALETTES ? wl.template : 'hash_game')

  const [palette, setPalette] = useState<Palette>(() =>
    wl.adminTheme?.mode === 'custom' ? wl.adminTheme.palette : { ...(wl.palette ?? TEMPLATE_PALETTES[start] ?? TEMPLATE_PALETTES.hash_game) }
  )

  const error = mode === 'custom' ? paletteError(palette) : undefined

  const body = (): AdminTheme | null => {
    if (mode === 'player') return null
    if (mode === 'default') return { mode: 'default' }
    const clean = Object.fromEntries(PALETTE_KEYS.map(k => [k, palette[k]])) as Palette

    return { mode: 'custom', palette: clean }
  }

  const save = useApiMutation({
    fn: () => api.put(`admin/whitelabels/${wl.id}/admin-theme`, { adminTheme: body() }),
    invalidate,
    success: wl.status === 'live' ? 'Admin colours saved — the admin panel shows them on its next load' : 'Admin colours saved for the setup'
  })

  return (
    <Card>
      <CardHeader className='flex flex-row items-start justify-between gap-4'>
        <div>
          <CardTitle>Admin panel colours</CardTitle>
          <CardDescription>The copy’s admin panel, set apart from the player site’s colours.</CardDescription>
        </div>
        <Button size='sm' disabled={save.isPending || Boolean(error)} onClick={() => save.mutate()}>
          {save.isPending && <Loader2Icon className='animate-spin' />} Save admin colours
        </Button>
      </CardHeader>
      <CardContent className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]'>
        <div className='grid content-start gap-4'>
          <SelectField id='wl-admin-mode' label='Admin panel colours' value={mode} onChange={v => setMode(v as Mode)} options={MODES} hint={HINTS[mode]} />
          {mode === 'custom' && (
            <>
              <SelectField
                id='wl-admin-start'
                label='Start from template'
                value={start}
                onChange={t => {
                  setStart(t)
                  setPalette({ ...(TEMPLATE_PALETTES[t] ?? TEMPLATE_PALETTES.hash_game) })
                }}
                options={Object.keys(TEMPLATE_PALETTES).map(k => ({ value: k, label: TEMPLATE_LABELS[k] ?? k }))}
                hint='Choosing a template replaces the colours below with its own.'
              />
              <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
                {ADMIN_TOKENS.map(key => (
                  <ColourRow key={key} label={TOKEN_LABELS[key]} color={palette[key]} onChange={c => setPalette(p => ({ ...p, [key]: c }))} />
                ))}
              </div>
              {error && <span className='text-destructive text-sm'>{error}</span>}
            </>
          )}
        </div>
        <div className='grid content-start gap-2'>
          <span className='text-muted-foreground text-sm'>Preview</span>
          {mode === 'default' ? (
            <div className='text-muted-foreground rounded-lg border p-4 text-sm'>The admin panel’s own colours — the same look as this panel.</div>
          ) : (
            <AdminPreview palette={mode === 'custom' ? palette : (wl.palette ?? TEMPLATE_PALETTES[wl.template] ?? TEMPLATE_PALETTES.hash_game)} name={wl.name} />
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export default AdminColours
