# Components

## Primitives — `components/ui/`

### `Button`

```tsx
<Button variant="primary" size="md" fullWidth={false}>Register</Button>
```

| Prop | Values | Default |
| --- | --- | --- |
| `variant` | `primary` \| `secondary` \| `ghost` \| `outline` | `primary` |
| `size` | `sm` (h-8) \| `md` (h-10) \| `lg` (h-12) | `md` |
| `fullWidth` | boolean | `false` |
| `as` | any component or tag | `'button'` |

Extends all native `<button>` props; `type` defaults to `"button"` so it never
submits a form by accident. Variants map straight onto brand tokens —
`primary` is `bg-piccolo` with `piccolo-80` hover and `piccolo-120` active.

Every variant carries a `0.8px` border, transparent where there is nothing to
draw. That is the reference's own convention, and it is what makes a filled and
an outlined button of the same size occupy the same box — without it `primary`
renders 1.6px narrower than `secondary` beside it.

For an action that is really navigation, pass `as`:

```tsx
<Button as={NavLink} to="/login" variant="secondary">Login</Button>
```

That renders one anchor carrying the button's classes, so the destination is a
real link — middle-click, copy-link, keyboard activation all behave. `type` is
only emitted when the element actually is a `button`. Never nest a `Link`
inside a `Button`: nested interactive elements are invalid and break keyboard
navigation.

### `Badge`

Overlay label on game tiles. `tone`: `brand` | `positive` | `caution` |
`negative` | `neutral` | `jackpot`. Uppercase, 10px, bold. `neutral` is
translucent black with a backdrop blur, for sitting over artwork.

### `Chip`

Pill filter used above category grids. Takes `active`, sets `aria-pressed`.

### `Icon`

```tsx
<Icon name="search" size={20} className="text-trunks" />
```

26 glyphs on a 24x24 grid, 1.75 stroke, drawn with `currentColor` so they
inherit text colour and theme automatically. Inline SVG — no icon font, no
package. `aria-hidden` by default; label the interactive parent instead.

Adding one: append a path to the `PATHS` map and its key to `IconName`.

### `Skeleton`

Pulsing `bg-beerus` block for loading states.

## Layout — `components/layout/`

### `Layout`

App shell and the only stateful layout piece. Owns the mobile menu and the
sidebar collapse, locks body scroll while the drawer is open, closes it on
route change and on `Escape`, and renders the skip-to-content link.

The shape is the reference's: a full-height sidebar column on the start side
and, to the right of it, a column holding the header above `<Outlet />` and the
footer. The header does **not** span the sidebar.

`main` carries `md:pt-10` — the reference's 40px gap between the header
and the first block, which it drops below `md` — and no bottom padding, since
the footer is always last and supplies its own.

### `Header`

Starts to the right of the sidebar, `h-16`, `px-4`. From `md` the sidebar owns
the logo and the collapse toggle, so the header carries only search, theme and
auth; below `md` the sidebar's brand block is hidden and the header shows the
logo and the hamburger instead. Collapsing narrows the sidebar to an icon rail
rather than removing it, so the toggle never leaves the column and the header
needs no copy of it.

Search is a 329x42 pill — `gohan` on a 0.8px `hit` hairline, a 12px glyph
inset 16px, and 16px text starting at 37px. The reference reserves 56px of
right padding for a control it never renders; we use `pe-4` instead, because
at 56px our placeholder clips.

There is no horizontal nav — the reference puts every destination in the
sidebar, and duplicating it here is what made the header feel like a generic
template.

> The theme toggle is **ours, not the reference's** — bitcasino.io ships light
> only. It stays because it is the only control for the dark theme this project
> implements; drop the button here if you want the header pixel-exact.

### `Sidebar` / `MobileSidebar`

One nav definition (`SidebarNav`), two presentations: a sticky full-height
256px column from `md`, and a slide-over drawer below it. The drawer is a real
`role="dialog" aria-modal` with a scrim, and translates rather than unmounting
so it animates both ways.

Measured off the reference: a 60px brand block (`p-3 pt-4 pb-3`) putting the
150x32 logo at 12,16 and a 32px toggle — `rounded-lg`, `gohan`, 16px glyph — at
the end of the same 232px row; a promo card with `min-h-[78px]` around 75px of
artwork; a hairline; then 40px link rows on a 4px rhythm. The grouped section
carries no padding of its own so it spans the full 232px column — the buttons
inside supply it. Locale and support sit in a `p-2 px-3` block at the bottom,
with no top border.

**Collapsing** narrows the column to the reference's 56px icon rail — it never
hides it. `width` is the only animated property, 256px → 56px over 200ms
linear, and the page content reflows against it on the same tween. The rail
carries `group/rail` plus `data-collapsed`, so each piece styles its own
collapsed form through `group-data-[collapsed=true]/rail:` instead of taking a
prop; `MobileSidebar` renders the same `SidebarNav` outside that group, so the
drawer is always the full-width form.

On the rail, measured off the reference: the brand row restacks to a column —
mark above toggle, 12px apart — growing the block from 60px to 104px; the promo
card goes; the hairline stays at `mx-3`; every row becomes a 32px icon square
on a 36px rhythm, animating `width,height,padding` at the Tailwind default
150ms so the rows settle before the column does; the grouped section keeps its
`gohan` surface, shrunk to the trigger's own square, and hides its children
without touching `liveOpen`, so re-expanding restores the group as it was left.

Labels become tooltips, as on the reference. Ours is a `fixed` span positioned
off the row's own box rather than a portalled popover — the column clips itself
(`overflow-hidden`, which keeps the wordmark from spilling over the page during
the tween) but a fixed child escapes that, since nothing in the column is a
containing block for fixed positioning.

### `Logo`

Placeholder brand mark — **not** the reference site's logo. 150x32, drawn
inline so the wordmark inherits `currentColor` and inverts with the theme.
`markOnly` drops the wordmark for narrow viewports. Replace the SVG here with
yours; the sidebar brand block and the mobile header both reserve the same
footprint.

Wrap it in a block-level parent (`className="flex"`), not an inline one — as an
inline-flex child it picks up baseline leading and renders 38px tall instead of
32, which pushes the whole brand block out by 6px.

### `Footer`

Fat footer, built to the reference's measurements: three bands separated by
`beerus` hairlines — an about/links/locale grid, a payment + social + licence
row, then awards.

The link columns are accordions below `2xl` (1536px) and plain columns at and
above it, which is where the reference switches. Collapsed height is `h-11`
(44px) — exactly `p-3` top, one 20px heading line, `p-3` bottom — so the
heading sits flush and everything under it is clipped. Open height is measured
from the body rather than assumed, so `transition-[height]` has something to
interpolate.

It cancels `main`'s horizontal padding with negative margins and applies its
own (`px-5`, `px-8` from `md`), so it spans the full column exactly as the
reference does, and it carries the page's bottom padding — `main` deliberately
has none.

### `ScrollToTop`

Renders nothing; resets scroll on pathname change.

## Sections — `components/sections/`

### `GameCard`

```tsx
<GameCard game={game} className="w-[140px]" />
<GameCard game={game} wide className="w-[244px]" />
```

Locked to `aspect-[140/188]`, or `aspect-[244/188]` with `wide` — the two
ratios the reference site uses. Both resolve to the same rendered height at a
given breakpoint, so a mixed rail stays aligned.

The tile carries **no caption**: title and studio are part of the artwork, as
they are on the reference site. That is what lets a rail read as one uniform
band rather than a row of images with ragged text beneath them.

Composition, bottom to top: artwork (`scale-105` on hover) → dark veil → play
button (fades in on hover) → badge (end/top) → live player count (start/top,
with a green dot) → jackpot amount (bottom, over a gradient).

Images are `loading="lazy" decoding="async"`. Hover transforms are on the
group, so the whole tile lifts as one.

### `Rail`

```tsx
<Rail title="Best Slot games" href="/categories/video-slots">{cards}</Rail>
```

The shell every horizontal row goes through — `GameRail` and `Testimonials`
both render into it, because the reference site gives them identical chrome: a
32px header line carrying the title and a "See all" link, a 20px gap, then the
scroller.

Scrolling is **native** CSS scroll-snap, so touch, trackpad and keyboard all
behave normally — the arrow buttons only call `scrollBy`. Arrow state is
tracked via a scroll listener plus a `ResizeObserver` so it stays correct when
the viewport changes. Arrows are hidden below `md`, where touch scrolling is
the expected affordance.

They are circular buttons floated over the ends of the row, and fade out
entirely when that direction has nothing left to scroll rather than showing as
disabled — a rail that fits should carry no visible controls at all.

### `GameRail`

```tsx
<GameRail title="Best Slot games" href="/categories/video-slots" games={games} />
```

`Rail` plus a row of `GameCard`s. `featured` switches the row to the wide
artwork; the home page uses it for the first rail only.

Returns `null` for an empty list rather than rendering an empty heading.

### `Hero`

Two-column banner set directly on the page background — no tinted panel. Black
display type and a single orange call to action on the start side, artwork
bleeding past the gutter on the end side. Below `md` the artwork moves above
the copy and runs full-bleed.

### `CategoryStrip`

Scrollable category shortcuts. Fixed 96/112px tiles. Sits below the game rails
rather than under the hero, which is where the reference puts the equivalent
row.

### `PromoGrid`

Three promo cards, one column on mobile and three from `md`. Each is a
gradient panel with a decorative circle that scales on hover.

### `ProviderRail`

Greyscale wordmark strip directly under the hero — no cards, no borders, no
game counts. Marks are generated placeholders, not real studio logos.

### `ThemeRail`

Curated-collection row. Tiles are landscape (16:9) rather than the portrait
ratio used for games, because they link to collection pages, not titles. Sits
between "Exclusives" and "Crash" on the home page, matching the reference.

### `TrustSection`

The whole editorial tail in **one** collapsed panel, which is how the reference
does it — trust, the game-category breakdown, providers, promotions and VIP,
the crypto explainer, and the getting-started guide, rather than a run of
separate bands. Keeping it collapsed is what stops a wall of copy pushing the
footer far down the page.

Measured off the reference: a `gohan` panel at `rounded-i-xs` (4px), `px-4 py-2`
on mobile and `p-8 pb-5` from `sm`; content clamped to `max-h-52` (208px), 192px
from `md`, behind a `from-gohan` gradient fade that is 48px tall, 72px from `md`;
then a centred `hit` pill, `h-10 px-4`, reading "Show more" / "Show less".

Type inside is `font-primary` throughout — the reference forces DM Sans here
even on headings, which our base stylesheet would otherwise set in Space
Grotesk. The scale, also measured: h2 28/36 `-0.56` semibold, h3 20/snug on
mobile and 24/30 from `sm` at `-0.44` medium, h4 18/28 `-0.18` medium, body and
lists 16/24 with 16px block margins and a 40px list indent. Links are `trunks`,
medium, **not** underlined.

Proper disclosure semantics: `aria-expanded` and `aria-controls` on the button,
`useId` for the content id.

### `SeoContent`

Standalone long-form block with its own "Read more" disclosure. **No longer
rendered on the home page** — `TrustSection` absorbed this role when the page
moved to the reference's single-panel shape. Kept for reuse on other routes.

### `VipBanner`

Loyalty band on the jackpot gradient, with a five-tier progression whose icon
opacity ramps across tiers.

### `CryptoFeatures`

Three-column explainer (privacy, speed, security) on a `gohan` surface, so it
reads as a distinct band between the promo and guide sections.

### `AccessAnywhere`

Cross-device band. The device mock on the end side is drawn inline with divs
and gradients rather than shipped as an image, and is `aria-hidden`.

### `GettingStarted`

Numbered three-step `<ol>` — account, deposit, withdraw. Step numbers are
absolutely positioned and `aria-hidden`, since the list already conveys order.

### `Testimonials`

Review row, the last block before the footer, rendered through `Rail`.

Cards are 256px tall and 288px wide, 320px from `md` — the reference's
measurements — on a `gohan` surface with the quote mark inset at the top-left.
The title clamps to two lines and the body to five, so a long review and a
short one produce the same card, and the star row is pinned to the bottom-left
rather than flowing after the text so it sits on one baseline across the rail.

Data carries `title`, `quote` and a 1-5 `rating`. The reference hides the
reviewer name outright; here it stays in the data and is exposed to screen
readers only, so the quote still has attribution. Quotes are written for this
project, not collected from real players.

## Pages

| Page | Responsibility |
| --- | --- |
| `Home` | Section order; splits `HOME_RAILS` at `THEME_RAIL_INDEX` to slot in `ThemeRail`. All game rails run consecutively, then `TrustSection` (the single collapsed editorial panel) and `Testimonials`. `CategoryStrip`, `SeoContent`, `PromoGrid`, `VipBanner`, `CryptoFeatures`, `AccessAnywhere` and `GettingStarted` still exist but are not rendered here |
| `Category` | Filters by route slug + provider chip; derives available studios from the games actually present |
| `Providers` | Studio index grid |
| `Play` | Breadcrumb, 16:9 frame placeholder, fun/real controls, similar-games rail; handles unknown slugs |
| `Login` | Split screen, outside `Layout` — see `AuthShell` |
| `SignUp` | Same shell, longer form — see `AuthShell` |
| `NotFound` | 404 |

### `AuthShell` — `components/layout/`

The two screens with no app shell. The reference drops sidebar, header and
footer on both `/login` and `/register`, and splits the viewport instead: a
380px form panel on the start side that scrolls on its own, and the remaining
width given to a dark marketing panel that is simply hidden below `md`,
leaving the form full width. There is no middle state.

```tsx
<AuthShell heading="Sign up" title="Your seat is waiting" benefits={BENEFITS} footer={<>…</>}>
  <form className="grid gap-2">…</form>
</AuthShell>
```

Everything above the OR rule is identical on both screens and lands on the same
coordinates, so it lives here: brand block, heading, provider row, divider,
marketing panel. Each page supplies only its form, its block of links, and the
marketing copy. `AuthField`, `AuthLabel`, `AuthCheckbox` and the `AUTH_INPUT` /
`AUTH_SELECT` class constants come from the same module.

Measured off the reference at 1500px, and reproduced to the pixel: 380px panel
on `p-5` → a 340px content column; 48px from the mark to the heading, 24px
between blocks, 8px inside the form; a `1fr 1fr auto` provider row at 4px
(146 / 146 / 40, all 40px tall); 40px controls whose label carries the 8px as
its own `pb-2`, so each label/control pair is one row of the form's grid.

Text fields and selects are styled differently, as on the reference — fields
are a 1.6px `hit` hairline on nothing, selects a filled `gohan` behind a 0.8px
`beerus` border. `Login` disables its submit until both fields carry something;
`SignUp` never disables `Create account`. Both match the reference.

`SignUp`'s two multi-control rows are sub-grids that supply their own 8px row
gap instead of the label padding, which is why their labels sit at 24 rather
than 32: date of birth is three equal 108px columns at 8px, phone is
`121px 1fr` at 16px so the dial code stays narrow.

The marketing panel's gradient is two circles — 786px `#FF2D00` bleeding in
bottom-start, 750px `#20D4C1` top-end — each under `blur-[290px]` on a
`#0F0025` ground. No image and no `background-image`, which is what lets the
colour hold at any panel width.

These two screens are a **verbatim clone**, unlike the rest of the project:
the artwork, provider marks, marketing copy, field labels and consent wording
are the reference's own, served from `/images/auth/`. `SignUp`'s marketing
consent ships pre-ticked because the reference pre-ticks it. See
[07 — Assets](./07-assets.md) for what that means before shipping.

The one thing missing is the captcha. The reference drops a reCAPTCHA widget
between `SignUp`'s consent boxes and its submit, which is what opens the 94px
gap there; there is no captcha service behind this build, so the submit sits at
723 and every row below matches the reference again.

There is no account system behind either form — submitting says so rather than
posting credentials anywhere.

## Conventions

- **Class merging** — always `cn()`, so a caller's `className` can override.
- **Logical properties** — `ps-`/`pe-`/`start-`/`end-`, never `pl-`/`left-`,
  so RTL works.
- **Named exports** everywhere except `App` (default, for the entry).
- **Path alias** — import via `@/`, never `../../..`.
- **Tokens only** — no hardcoded hex in components.
