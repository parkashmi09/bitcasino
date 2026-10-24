# Reference site analysis

Everything below was measured on **2026-09-05** from bitcasino.io's own HTTP
responses and served stylesheets — response headers, the server-rendered HTML
document, and the four CSS chunks it links.

## Stack

| Layer | Finding | Evidence |
| --- | --- | --- |
| Framework | **Next.js**, App Router | `X-Powered-By: Next.js`, `/_next/static/chunks/*` |
| Rendering | **PPR** (Partial Prerendering) with RSC | `x-nextjs-postponed: 1`, `x-nextjs-prerender: 1`, `Vary: rsc, next-router-state-tree, next-router-prefetch` |
| Bundler | **Turbopack** | `/_next/static/chunks/turbopack-*.js` |
| CSS | **Tailwind CSS v4** | `@layer properties` + `--tw-*` init block, `oklch()` default palette, `--breakpoint-*` theme vars |
| Design system | **Moon Design System** (Coingaming, MIT) | Token names `piccolo`, `goku`, `gohan`, `beerus`, `trunks`, `bulma`, `popo` |
| Edge / CDN | **Cloudflare** in front of **AWS ALB** | `Server: cloudflare`, `CF-Ray`, `AWSALB` cookie, `x-amzn-trace-id` |
| Images | **imgix** | `heathmont.imgix.net`, `hub88.imgix.net` |
| Caching | Fully dynamic HTML | `CF-Cache-Status: DYNAMIC`, `Cache-Control: private, no-store` |

The document is ~830 KB of server-rendered HTML with RSC flight data inline,
and links **4 CSS chunks totalling ~356 KB** (the largest is ~336 KB).

### Tailwind v4 confirmation

Class names in the markup use v4-only syntax:

- `max-md:hidden!` — trailing-bang important modifier (v3 used `!hidden`)
- `z-1`, `z-3`, `rounded-b-xs` — v4's re-based scales
- `[&_p]:!text-xs`, `[grid-area:five]` — arbitrary variants and properties

### Multi-tenant CSS

One bundle serves several Yolo Group brands. Theme blocks are keyed by a class
on `<html>`; the document requested here carried:

```html
<html dir="ltr" lang="en" class="bitcasino light light-theme">
<body class="font-primary antialiased">
```

So **Bitcasino is a light theme**, and the same CSS also contains dark-themed
sibling brands. That is why a naive grep of the stylesheet returns three
different values for `--goku` and `--piccolo` — you have to read the
`.bitcasino` block specifically.

## The `.bitcasino` theme block

Verbatim token values from the served stylesheet, reformatted for reading:

```css
.bitcasino {
  --primary:   #f2590d;   --ring:        #f2590d;
  --background:#fff;      --foreground:  #000;
  --card:      #fff;      --muted:       #e0e0e0;
  --border:    #e9e9e9;   --destructive: #ff4e64;
  --radius: .625rem;
  --font-primary: "DM Sans";
  --font-secondary: "Space Grotesk";

  /* Moon palette, as space-separated RGB channels */
  --piccolo: 242 89 13;    --piccolo-80: 250 100 46;  --piccolo-120: 245 65 0;
  --goku:  255 255 255;    --goku-40: 216 224 227;    --goku-80: 234 238 240;
  --gohan: 249 247 246;    --beerus: 224 224 224;     --hit: 233 233 233;
  --bulma: 0 0 0;          --trunks: 126 117 114;     --goten: 255 255 255;
  --popo: 0 0 0;           --heles: 0 0 0 / .08;      --zeno: 0 0 0 / .4;
  --jiren: 242 89 13 / .12;
  --krillin: 255 179 25;   --chichi: 255 78 100;      --roshi: 73 179 86;
  --dodoria: 211 48 48;    --whis: 52 72 240;         --cell: 149 241 213;
  --raditz: 179 128 74;    --frieza: 92 51 207;       --nappa: 114 85 80;
  --jackpot-primary: 120 16 245;  --jackpot-secondary: 50 11 159;
}
```

### Moon token semantics

| Token | Role |
| --- | --- |
| `piccolo` | Brand / primary action (`-80` hover, `-120` pressed) |
| `goku` | App background |
| `gohan` | Raised surface — cards, inputs, chips |
| `beerus` | Borders and dividers |
| `hit` | Subtle fill / pressed surface |
| `bulma` | Primary text |
| `trunks` | Secondary and muted text |
| `goten` | Text on brand-coloured surfaces |
| `popo` | Pure black — media backdrops |
| `heles` / `zeno` | Hover veil / modal scrim (alpha) |
| `jiren` | Brand tint for active nav states |
| `krillin` / `chichi` / `roshi` / `dodoria` / `whis` | Caution / negative / positive / critical / info |

The site also carries a newer Radix-style scale alongside the legacy names
(`--color-piccolo-9`, `--color-neutral-12`, `--color-background-brand`, …),
suggesting a migration in progress. This project targets the legacy names,
which are what the rendered markup actually uses.

## Typography

Three families appear across the bundle:

| Family | Licence | Used by |
| --- | --- | --- |
| Averta Std | Commercial (Intelligent Design) | Sibling brands |
| **DM Sans** | SIL OFL 1.1 | Bitcasino body |
| **Space Grotesk** | SIL OFL 1.1 | Bitcasino display |

This project self-hosts the two open families. See
[07 — Assets](./07-assets.md).

## Layout metrics

| Property | Value |
| --- | --- |
| Breakpoints | `md: 768px`, `xl: 1200px` |
| Base radius | `0.625rem`; Moon steps `i-xs .25` / `i-sm .5` / `i-md .75` / `s-lg 1rem` |
| Spacing | 1px-based ramp (`space-1` … `space-104`) alongside Tailwind's `0.25rem` |
| Game thumbnail | 140 x 188 px rendered (0.745 portrait); featured tiles 244 x 188 (1.3) |

## Page structure

Section order on the home page, from the document's heading outline:

1. Hero — "Join the world's first licensed Bitcoin casino"
2. Welcome-offer band
3. Transaction-speed trust strip
4. Game rails: Originals → Best Live Casino → Best Slots → New Releases →
   Exclusives → Themes → Crash & Instant Win → Best table games
5. Trust section ("A Bitcoin casino you can trust": selection, fun/real mode,
   tournaments, payment methods)
6. SEO body copy (slots / live / table / lottery breakdowns)
7. Software providers
8. Promotions and VIP
9. Crypto explainer (anonymity, speed, security)
10. Getting-started guide, testimonials
11. Footer

## Route shapes

```
/categories/:slug     live-casino, video-slots, baccarat, blackjack, roulette, …
/providers            /providers/:slug
/themes/:slug         live-exclusives, vip-prive, bitcasino-exclusives, bonus-buy-in
/play/:category/:game
/promotions           /promotions/:campaign
/tournaments  /blog  /register
```

`/play/:category/:slug` is the shape this project adopts.

## Reproducing this analysis

```bash
curl -sL -A "<a browser UA>" https://bitcasino.io/ -o page.html
grep -oE '/_next/static/chunks/[^"]+\.css' page.html | sort -u
curl -sL "https://bitcasino.io/_next/static/chunks/<file>.css" -o app.css
grep -oE '\.bitcasino[^{]*\{[^}]*' app.css
```

Chunk hashes change on every deploy, so re-read them from the HTML rather than
hardcoding. Note the site is geo-aware — it sets `countryCode` and
`countryBlocked` cookies, so markup may differ by region.
