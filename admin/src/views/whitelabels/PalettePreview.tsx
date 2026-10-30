'use client'

import type { CSSProperties } from 'react'

import type { Palette } from './types'

/**
 * A small mock of the player site in these colours — header, sidebar, cards, a live badge and the
 * brand button — drawn with the same 13 tokens the site uses (frontend/src/theme/palettes.css).
 * A likeness for choosing colours, not a render of the real pages.
 */
const PalettePreview = ({ palette, name, logoUrl }: { palette: Palette; name: string; logoUrl?: string | null }) => {
  const p = palette
  const card: CSSProperties = { background: p.s2, border: `1px solid ${p.border}`, borderRadius: 8 }

  return (
    <div className='overflow-hidden rounded-lg border text-[11px] leading-tight' style={{ background: p.bg, color: p.text }} aria-label='Colour preview'>
      <div className='flex items-center gap-2 px-3 py-2' style={{ background: p.s1, borderBottom: `1px solid ${p.border}` }}>
        {logoUrl ? (
           
          <img src={logoUrl} alt='' className='h-5 max-w-24 object-contain' />
        ) : (
          <span className='font-semibold' style={{ color: p.primary }}>
            {name || 'Your site'}
          </span>
        )}
        <span className='ml-auto rounded px-2 py-1' style={{ background: p.s3, color: p.text }}>
          Sign in
        </span>
        <span className='rounded px-2 py-1 font-semibold' style={{ background: p.primary, color: p.ink }}>
          Sign up
        </span>
      </div>
      <div className='flex'>
        <div className='hidden w-24 shrink-0 space-y-1 p-2 sm:block' style={{ background: p.s1 }}>
          {['Casino', 'Sports', 'Promotions', 'VIP Club'].map((item, i) => (
            <div key={item} className='rounded px-2 py-1' style={i === 0 ? { background: p.s3, color: p.text } : { color: p.muted }}>
              {item}
            </div>
          ))}
        </div>
        <div className='min-w-0 flex-1 space-y-2 p-3'>
          <div className='rounded-lg p-3' style={{ background: `linear-gradient(90deg, ${p.lo}, ${p.primary})`, color: p.ink }}>
            <div className='text-sm font-bold'>Welcome bonus</div>
            <div style={{ opacity: 0.8 }}>Up to 100% on your first deposit</div>
          </div>
          <div className='grid grid-cols-3 gap-2'>
            {['Crash', 'Dice', 'Limbo'].map(game => (
              <div key={game} className='p-2' style={card}>
                <div className='mb-1 h-8 rounded' style={{ background: p.s3 }} />
                <div className='font-medium'>{game}</div>
                <div style={{ color: p.muted }}>Originals</div>
              </div>
            ))}
          </div>
          <div className='flex items-center gap-2 p-2' style={card}>
            <span className='rounded px-1.5 py-0.5 font-bold' style={{ background: p.live, color: '#fff' }}>
              LIVE
            </span>
            <span>India v Australia</span>
            <span className='ml-auto' style={{ color: p.accent }}>
              View market
            </span>
            <span style={{ color: p.hi }}>1.85</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default PalettePreview
