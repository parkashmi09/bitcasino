'use client'

import { useMemo, useSyncExternalStore } from 'react'

/**
 * Chart colours come from the admin's CSS tokens (`app/globals.css`), never from hex in a view.
 *
 * Each token is read from the computed style of `<html>` and normalised to `rgb()/rgba()` by
 * painting it onto a 1×1 canvas (the browser does the colour-space maths), so a colour works in
 * every SVG attribute and gradient stop, whatever colour space the token is written in.
 *
 * Theme switches are seen through a MutationObserver on `<html class>`: next-themes flips the
 * `dark` class from its own effect, which runs AFTER a child's effect, so reading on the
 * `resolvedTheme` change alone would sometimes read the old mode.
 */

/** Categorical slots, in fixed order. Series take them in this order; never cycled. */
export const SERIES_TOKENS = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6', 'chart-7', 'chart-8'] as const

/** Any token a series may be painted with. Status tokens are for status meaning only. */
export type ChartColor = (typeof SERIES_TOKENS)[number] | 'primary' | 'success' | 'danger' | 'warning' | 'info' | 'muted-foreground'

const UI_TOKENS = ['foreground', 'muted-foreground', 'border', 'card', 'popover', 'popover-foreground', 'muted', 'chart-axis', 'chart-grid'] as const
const ALL_TOKENS = [...SERIES_TOKENS, ...UI_TOKENS, 'primary', 'success', 'danger', 'warning', 'info'] as const

type Token = (typeof ALL_TOKENS)[number]

export type ChartTheme = {
  mode: 'light' | 'dark'
  color: Record<Token, string>

  /** Resolve a series colour token (or pass a literal colour straight through). */
  resolve: (c: ChartColor | string | undefined, index: number) => string
  fontFamily: string
}

const cache = new Map<string, string>()
let ctx: CanvasRenderingContext2D | null | undefined

/** Any CSS colour → `rgb(r, g, b)` / `rgba(r, g, b, a)`; unchanged when the canvas is unavailable. */
export function toRgb(value: string): string {
  const v = value.trim()

  if (!v) return v
  const hit = cache.get(v)

  if (hit) return hit

  if (ctx === undefined) {
    try {
      const canvas = document.createElement('canvas')

      canvas.width = canvas.height = 1
      ctx = canvas.getContext('2d', { willReadFrequently: true })
    } catch {
      ctx = null
    }
  }

  if (!ctx) return v
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = '#000'
  ctx.fillStyle = v
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
  const out = a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`

  cache.set(v, out)

  return out
}

const subscribe = (onChange: () => void) => {
  const obs = new MutationObserver(onChange)

  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-luno'] })

  return () => obs.disconnect()
}

const snapshot = () => {
  const el = document.documentElement

  return `${el.className}|${el.getAttribute('style') ?? ''}|${el.getAttribute('data-theme') ?? ''}|${el.getAttribute('data-luno') ?? ''}`
}

/** Re-renders whenever the theme class on `<html>` changes. */
export function useChartTheme(): ChartTheme {
  const key = useSyncExternalStore(subscribe, snapshot, () => 'ssr')

  return useMemo(() => {
    const color = {} as Record<Token, string>
    const isBrowser = typeof window !== 'undefined' && key !== 'ssr'
    const style = isBrowser ? getComputedStyle(document.documentElement) : null

    // A status token drawn as a mark uses its chart shade (`--chart-success`…) when globals.css defines one.
    const read = (t: string) => (style ? toRgb(style.getPropertyValue(`--chart-${t}`) || style.getPropertyValue(`--${t}`)) || 'currentColor' : 'currentColor')

    for (const t of ALL_TOKENS) color[t] = read(t)

    const mode: 'light' | 'dark' = isBrowser && document.documentElement.classList.contains('dark') ? 'dark' : 'light'
    const fontFamily = style ? getComputedStyle(document.body).fontFamily : 'inherit'

    const resolve = (c: ChartColor | string | undefined, index: number) => {
      if (!c) return color[SERIES_TOKENS[index % SERIES_TOKENS.length]]
      if (c in color) return color[c as Token]

      return c
    }

    return { mode, color, resolve, fontFamily }
  }, [key])
}
