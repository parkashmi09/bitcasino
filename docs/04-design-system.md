# Design system

Tokens follow the Moon Design System naming convention (open source, MIT), the
same vocabulary the reference site uses. Values for the light theme are the
ones served in its `.bitcasino` block; the dark theme uses the dark values
carried in the same bundle.

## Where things live

```
apps/web/src/styles/
├── tokens.css    raw token values per theme (.theme-light / .theme-dark)
├── index.css     Tailwind import, @theme mapping, base layer, utilities
└── fonts.css     generated @font-face rules — do not edit by hand
```

## How theming works

Two layers, deliberately separated:

1. **`tokens.css`** sets raw RGB channels on a theme class:
   ```css
   .theme-light { --piccolo: 242 89 13; }
   .theme-dark  { --piccolo: 242 89 13; --goku: 26 33 42; }
   ```
2. **`index.css`** maps them to Tailwind colours with `@theme inline`:
   ```css
   @theme inline { --color-piccolo: rgb(var(--piccolo)); }
   ```

`inline` is what makes this work. Without it, Tailwind bakes the value into
each utility at build time and swapping the class does nothing. With it,
`bg-piccolo` compiles to `background-color: var(--color-piccolo)`, which
resolves through the theme class at runtime.

Channels are stored space-separated (`242 89 13`) rather than as hex so alpha
tokens like `--heles: 0 0 0 / .08` use the same mechanism.

Switching themes is one class on `<html>`, handled by `lib/theme.js` and
applied in `main.jsx` before first paint to avoid a flash.

## Colour tokens

| Token | Role | Light | Dark |
| --- | --- | --- | --- |
| `piccolo` | Brand / primary | `#F2590D` | `#F2590D` |
| `piccolo-80` | Brand hover | `#FA642E` | `#FA642E` |
| `piccolo-120` | Brand pressed | `#F54100` | `#F54100` |
| `goku` | App background | `#FFFFFF` | `#1A212A` |
| `gohan` | Raised surface | `#F9F7F6` | `#2C323A` |
| `beerus` | Border | `#E0E0E0` | `#373D45` |
| `hit` | Subtle fill | `#E9E9E9` | `#4C515A` |
| `bulma` | Primary text | `#000000` | `#FFFFFF` |
| `trunks` | Muted text | `#7E7572` | `#8D9DA8` |
| `goten` | Text on brand | `#FFFFFF` | `#FFFFFF` |
| `popo` | Media backdrop | `#000000` | `#000000` |
| `heles` | Hover veil | `rgb(0 0 0 / .08)` | `rgb(255 255 255 / .12)` |
| `zeno` | Modal scrim | `rgb(0 0 0 / .4)` | `rgb(25 30 37 / .4)` |
| `jiren` | Active nav tint | `rgb(242 89 13 / .12)` | same |
| `krillin` | Caution | `#FFB319` | `#F8C100` |
| `chichi` | Negative | `#FF4E64` | `#FF4E64` |
| `roshi` | Positive | `#49B356` | `#4AD15F` |
| `dodoria` | Critical | `#D33030` | `#FF8A01` |
| `whis` | Info | `#3448F0` | `#2E69FF` |
| `jackpot` / `jackpot-2` | Jackpot ramp | `#7810F5` / `#320B9F` | same |

### Using them

```tsx
<div className="bg-gohan text-bulma border border-beerus rounded-i-md">
  <span className="text-trunks">Muted</span>
  <button className="bg-piccolo text-goten hover:bg-piccolo-80">Play</button>
</div>
```

Never hardcode a hex value in a component. If you need a colour that isn't
here, add a token — that is how the dark theme keeps working.

## Typography

| Role | Family | Weights | Utility |
| --- | --- | --- | --- |
| Body | DM Sans | 400, 500, 700 | `font-primary` (default on `body`) |
| Display | Space Grotesk | 500, 700 | `font-secondary` (default on `h1`–`h6`) |
| Tile title | Big Shoulders | 900 | `font-display` |

All three are SIL OFL 1.1 and self-hosted as woff2 with `font-display: swap`.
The 400 body weight and 700 display weight are preloaded in `index.html`.

`font-display` has exactly one caller: the name set over a game tile in
`GameCard`, which is the one place the reference uses it too. It is a condensed
face, and that is the point — a two-word title fits on one line at 22px inside
a 140px tile, which neither of the other two families manages.

Headings get `font-weight: 700` and `letter-spacing: -0.01em` in the base
layer, matching the reference site's tighter display setting.

## Radius

Moon's scale, mapped onto Tailwind's `rounded-*`:

| Utility | Value | Use |
| --- | --- | --- |
| `rounded-i-xs` | 4px | Badges, tags |
| `rounded-i-sm` | 8px | Icon buttons, small controls |
| `rounded-i-md` | 12px | Buttons, inputs, game tiles, cards |
| `rounded-s-sm` / `-md` / `-lg` | 8 / 12 / 16px | Surfaces — panels, hero, promo cards |
| `rounded-full` | — | Chips, avatars, rail arrows |

`i-` is interactive, `s-` is surface. Both scales exist in Moon; surfaces get
the larger radius at the same nominal step.

## Breakpoints

Only two, matching the reference site:

| Name | Min width | Layout change |
| --- | --- | --- |
| *(base)* | 0 | Single column, slide-over nav, 3-up game grid |
| `md` | 768px | Search visible, 5-up grid, rail arrows appear |
| `xl` | 1200px | Persistent sidebar, top nav visible, 7-up grid |

Content is capped at `max-w-[1440px]`.

## Custom utilities

Defined in `index.css` under `@layer utilities`:

- **`.rail`** — the horizontal game row: `grid-auto-flow: column`, x-scroll,
  `scroll-snap-type: x mandatory`, scrollbar hidden, `overscroll-behavior-x:
  contain` so a rail at its end doesn't trigger browser back-swipe.
- **`.no-scrollbar`** — hides scrollbars without disabling scrolling.
- **`.fade-bottom`** — the transparent-to-black gradient used over artwork.

## Accessibility baked in

- `:focus-visible` gets a 2px `piccolo` outline with 2px offset, globally.
- A `prefers-reduced-motion` block collapses all animation and smooth scrolling.
- Layout uses logical properties (`ps-`, `pe-`, `start-`, `end-`) throughout,
  so switching `<html dir="rtl">` mirrors correctly. The rail's scroll maths
  uses `Math.abs(scrollLeft)` for the same reason.
