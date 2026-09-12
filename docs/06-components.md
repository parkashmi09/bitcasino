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

Pill filter. Takes `active`, sets `aria-pressed`. Two variants, both the
reference's: `solid` (brand fill on selection) and `tint` (a 12% brand wash
under brand text — the form the search dialog's category pills use). Game
lists filter through `Select` rather than chips, because that is what the
reference uses there.

### `Select`

```tsx
<Select label="Providers" placeholder="All Game Providers"
        options={options} value={value} onChange={setValue} />
<Select variant="outline" label="Sort by" options={SORTS} … />
```

The game-list filter dropdown. A button plus a popover listbox rather than a
native `<select>`, matching the reference — which means it also carries the
keyboard contract a native select would have given for free: Arrow/Home/End
move the active option, Enter or Space commits, Escape closes and returns
focus to the button, an outside press dismisses. Focus moves to the list and
options are tracked with `aria-activedescendant`.

Two variants, both the reference's own: `filled` (Categories / Providers —
`goku`, inset ring, rotating caret) and `outline` (Sort — transparent, paired
chevrons). Options are `[{ value, label }]`; the "All …" entry is a real
option with an empty `value`, since it is the only way back to an unfiltered
list, and an empty value renders the button text in `trunks`.

### `Breadcrumb`

Trail under a game list. `items` is `[{ label, to }]`, outermost first, and
the last entry renders unlinked. The reference puts this **below** the grid,
not above it, and opens it with the brand mark rather than a "Home" label.

### `Icon`

```tsx
<Icon name="search" size={20} className="text-trunks" />
```

31 glyphs on a 24x24 grid, 1.75 stroke, drawn with `currentColor` so they
inherit text colour and theme automatically. Inline SVG — no icon font, no
package. `aria-hidden` by default; label the interactive parent instead.

Adding one: append a path to the `PATHS` map and its key to `IconName`. Pass
`solid` to fill the glyph with `currentColor` instead of stroking it.

### `Skeleton`

Pulsing `bg-beerus` block for loading states.

## Layout — `components/layout/`

### `Layout`

App shell and the only stateful layout piece. Owns the mobile menu, the search
dialog and the sidebar collapse, locks body scroll while the drawer is open,
and closes it on route change and on `Escape`.

There is no skip-to-content link. It was the first focusable node in the
document, so it took the first Tab after every load and route change and
painted itself over the brand — and the reference ships none. `main` keeps its
id, so `#main` still resolves.

The shape is the reference's: a full-height sidebar column on the start side
and, to the right of it, a column holding the header above `<Outlet />` and the
footer. The header does **not** span the sidebar.

`main` carries `md:pt-10` — the reference's 40px gap between the header
and the first block, which it drops below `md` — and no bottom padding, since
the footer is always last and supplies its own.

### `Header`

Starts to the right of the sidebar, `h-16`, `px-4`. From `md` the sidebar owns
the logo and the collapse toggle, so the header carries only search and auth;
below `md` the sidebar's brand block is hidden and the header shows the
logo and the hamburger instead. Collapsing narrows the sidebar to an icon rail
rather than removing it, so the toggle never leaves the column and the header
needs no copy of it.

Search is a 329x42 pill — `gohan` on a 0.8px `hit` hairline, a 12px glyph
inset 16px, and 16px text starting at 37px. The reference reserves 56px of
right padding for a control it never renders; we use `pe-4` instead, because
at 56px our label clips.

The pill is a **button, not an input**: pressing it opens `SearchDialog`, which
owns the field. That is the reference's own behaviour — its header field never
receives the query. Below `sm` the pill does not fit beside the brand, so it
collapses to the search icon on the right, which opens the same dialog.

There is no horizontal nav — the reference puts every destination in the
sidebar, and duplicating it here is what made the header feel like a generic
template.

The actions are the reference's two and nothing else: Login and Sign Up. There
is **no theme toggle** — bitcasino.io ships light only. The dark palette still
exists and `main.jsx` still applies whatever `lib/theme` has stored, so setting
`bc.theme` switches the app; it simply has no control in the UI.

### `RouteProgress`

The top-of-page loading bar, mounted in `App` beside `ScrollToTop` so it covers
every internal navigation, auth screens included.

The reference runs stock **NProgress** with the brand colour swapped in. Read
off the live site, its stylesheet is:

```css
#nprogress .bar  { position: fixed; top: 0; left: 0; width: 100%;
                   height: 3px; background: rgb(var(--piccolo)); z-index: 1600 }
#nprogress .peg  { position: absolute; right: 0; width: 100px; height: 100%;
                   box-shadow: 0 0 10px …, 0 0 5px …;
                   transform: rotate(3deg) translate(0, -4px) }
#nprogress .spinner-icon { 18px, 2px border, top + left in brand,
                   border-radius: 50%, spin 400ms linear infinite }
```

Not a media query in it, and both pieces are fixed to the viewport, so a phone
gets exactly what a desktop does — which is why this component carries no
breakpoints. The spinner is at `top: 15px; right: 15px`, which on both sites
puts it over the Sign Up button, where an orange ring on an orange fill is
effectively invisible. It is reproduced anyway, because the reference has it.

Motion is the reference's: mount at `-100%`, slide to 8% over 200ms, creep
forward in small steps that shrink as the bar fills, then on arrival run to
100% over 200ms and fade out over another 200ms before unmounting.

`FLOOR_MS` is **ours**. The reference is Next.js, so a route change waits on an
RSC payload and the bar has something real to measure; this is a Vite SPA with
every route in one bundle, so navigation is synchronous and the bar would mount
and complete inside a single frame. The floor holds it on screen for 500ms
first, so the whole run reads at about 900ms. It delays nothing — the new page
is already painted underneath it.

Nothing is shown on the first paint: a hard load has the browser's own progress
UI, and the reference does not double it.

### `SearchDialog`

```tsx
<SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
```

Search, opened from the header. There is no `/search` route: the reference 404s
on one and runs search as a dialog over whatever page you are on, so this does
too.

Its geometry is the reference's, breakpoint for breakpoint — a full-bleed sheet
below `md`, then `85vw x 56vw` capped at `90vh`, then a fixed 1096px card whose
height steps 640 → 700 → 744 as the viewport passes 1280, 1440 and 1536. Those
three are raw media queries rather than `xl:` / `2xl:`, because this project
remaps `--breakpoint-xl` to 1200 and the reference's steps sit on Tailwind's
stock values. The grid steps 3 → 5 → 7 → 8 columns on the same widths, and
reuses `GameCard`.

Inside: the field row (field, "Random Game", close), the category pills
(`Chip variant="tint"` — All / Slots / Live Casino / Originals), then a
scrolling area holding the count heading and the grid. Typing swaps the heading
from "Most Popular Games" to "Results"; the badge beside it counts the whole
list, not the loaded page. A search matching nothing shows the reference's
empty state — stacked-tile illustration, "Nothing found", a "Random Game"
button — with the popular list still running underneath it, uncounted.

Three pieces move between breakpoints, all of them the reference's:

- **Random Game** sits beside the field from `md`, and becomes a pill fixed
  above the safe area on a phone. While the empty state is up it leaves the
  row, because the empty state carries its own.
- **Load more** is desktop-only. Below `md` the reference drops the button and
  pages the list in as you reach the end of the scroller.
- The empty-state illustration is hidden on a phone.

Over the last row sits the reference's fade — `popo` to transparent at 50%,
300ms — up while the scroller has further to go or a page is still unloaded,
which is also what keeps the white "Load more" pill legible.

Enter and leave are the reference's fade plus 95% zoom over 150ms
(`animate-dialog-in` / `-out` in `styles/index.css`); the panel stays mounted
for that last frame so the leave actually plays. Focus moves to the field on
open and back to whatever opened it on close, `Escape` closes, body scroll is
locked while it is up, and choosing a game closes it on the way to the play
page.

Search matches game titles **and** studio names, so typing a provider returns
its catalogue — the reference behaves the same way, and shows no separate
providers section.

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

The hairlines **fade** — `hit` at the start, transparent by the end of the
232px — which is what the reference draws. Flat, they read as three boxed
sections rather than one column.

**A session adds a row.** Between the promo card and the links, a signed-in
visitor gets the reference's two shortcut pills and a second hairline under
them: 36px tall, `gohan`, a ~5px radius (tighter than the 12px on the cards, so
they read as controls rather than a third card), each ending in a 20px `goku`
disc holding a count. `Recents` is a link to `/games/recent` — the same page the
header's `RecentsLink` opens — and its badge is the length of that page's own
list, fetched once in `Layout` and passed down, since `SidebarNav` is mounted
twice at every width. The star is a readout: no favourites feature exists, so it
has no role, no tab stop and no hover, and its `0` is true. The rail drops the
whole row, second hairline included.

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

### `ErrorBoundary` / `RouteErrorBoundary`

```tsx
<RouteErrorBoundary><Outlet /></RouteErrorBoundary>
```

The one class component in the app, because `componentDidCatch` has no hook
equivalent and React 19 has not changed that.

**It is not where failed requests go.** A read that fails is a STATE, drawn by
`QueryState` next to a page that still works. What lands here is a component
that threw while RENDERING — a field that was an object where a string was
expected, a `.map` on something that turned out to be null. Without a boundary
React unmounts the whole tree on one of those, and a blank page on a site whose
header carries the balance is indistinguishable from an outage.

Two are mounted. `Layout` wraps the routed outlet, so a page that throws leaves
the shell navigable; `main.jsx` wraps everything, for the auth screens (which
render outside `Layout`) and for the router and session provider themselves.

`RouteErrorBoundary` re-keys the boundary on the pathname, and that is the part
worth guarding. React never clears a caught boundary on its own, so without it
one broken page poisons the whole session: the player presses Home, the URL
changes, and the same apology stays on screen. It is pinned by a test.

## Sections — `components/sections/`

### `GameCard`

```tsx
<GameCard game={game} className="w-[140px]" />
<GameCard game={game} wide className="w-[244px]" />
```

Locked to `aspect-[140/188]`, or `aspect-[244/188]` with `wide` — the two
ratios the reference site uses. Both resolve to the same rendered height at a
given breakpoint, so a mixed rail stays aligned.

`wide` only takes effect **from `sm`**. The reference's featured tile is
`max-w-26 max-h-35 sm:max-w-61 sm:max-h-47` — a 104x140 box on a phone and a
244x188 one from `sm` — and 104x140 is the portrait ratio, not the wide one. So
below `sm` the tile takes the portrait crop and the featured rail sits on the
same baseline as every other rail. That is why the artwork goes through
`<picture>` with a `(min-width: 640px)` source rather than a `src`: the two
crops are separate files, and loading both to hide one would cost a phone an
image it never shows. `block size-full` on the `<picture>` is load-bearing —
it is an inline box by default, and the image's `h-full` resolves against it.

The tile carries **no caption**: title and studio are part of the artwork, as
they are on the reference site. That is what lets a rail read as one uniform
band rather than a row of images with ragged text beneath them.

Composition, bottom to top: artwork → badge (end/top) → live player count
(start/top, with a green dot) → jackpot amount (bottom, over a gradient) →
hover veil, on top of all of it at `z-3`.

The hover state is a single element and is **identical on every tile**: a
`bg-popo/60` veil that fades `opacity-0` → `opacity-90` in 150ms, carrying a
48px `bg-goten/50 backdrop-blur-sm` disc with a filled white play triangle.
Nothing moves — the reference home page has no `group-hover:scale` and no
`hover:-translate-y` on any of its 71 tiles, so neither does this component.
The veil is `pointer-events-none`, so it never intercepts the link.

Images are `loading="lazy" decoding="async"`.

### `GameList`

```tsx
<GameList title="Slots" games={games} filter={{…}} breadcrumb={[…]} />
```

The chrome every game-listing page shares, in the reference's order: title and
filter bar on one line, then the grid, then the breadcrumb — which sits *below*
the grid, not above it.

The filter bar is always the same pair. One dropdown narrows the list by the
axis the page is **not** already fixed to (a category page filters by provider,
a provider page by category); `filter` carries it as
`{ label, placeholder, options, value, onChange }`. The other sorts, and is
owned here because every list sorts identically — the reference's own five
options, from its payload: Popularity, A-Z, Volatility, Hit Ratio, RTP.
`popular` has no comparator on purpose: popularity *is* the catalogue order the
list arrives in, so picking it restores that order.

`filter` is OPTIONAL, and it carries the sort control with it — both dropdowns
or neither. `/games/recent` is the page with neither: the reference draws it as
a bare heading, because a play history has no second axis to narrow by and
"most recent first" is the only order that means anything. With no `filter`
the list is also left in the order it arrived rather than sorted.

`empty` replaces the "No games match this filter yet." line for a page where
that sentence would be wrong — Recently played says nothing has been played,
which is a different thing from a filter matching nothing.

The heading is DM Sans at 24/32 weight 400, the same as the account pages'.
It was Space Grotesk at `font-light` until it was checked against the
reference, whose `h1` on every listing page computes to `24px/32px`,
weight `400`, `"DM Sans"`.

The grid is the reference's auto-fitting one, its track floor stepping
6.5rem → 7.75rem → 8.75rem, so the column count follows the viewport rather
than a breakpoint.

### `Rail`

```tsx
<Rail title="Best Slot games" href="/categories/video-slots">{cards}</Rail>
```

The shell every horizontal row goes through — `GameRail`, `Testimonials`,
`LatestWins` and the tournaments page all render into it, because the reference
site gives them identical chrome: a 32px header line, a 20px gap, then the
scroller.

That header line has **three** shapes. A rail over a catalogue list has
somewhere to send the player and gets the `See all` link. A LIVE rail does not
— there is no page listing every bet ever settled — so `href` is optional and
the link is omitted rather than rendered with an undefined destination: a
`<Link>` with no `to` resolves to the CURRENT route, which looks real and does
nothing. `action` is the third: arbitrary controls in the link’s place, for
`LatestWins`’ `Latest / Biggest` switch. It replaces the link rather than
sitting beside it — the reference never shows both, and a row with a tab group
AND a `See all` reads as two affordances for one thing.

`headingClassName` overrides the title's type, and `className` its gap — `cn`
is `twMerge`, so both genuinely replace the defaults. That is how `/tournaments`
runs the same chrome as a subheading under its own `h1`: 18px `trunks` on an
8px gap rather than 24px display `bulma` on 20px. The element stays an `h2`
either way, which the reference's own `<span>` is not.

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

Tile widths are the reference's own, read off its tile: `w-[104px]
md:w-[124px] lg:w-[140px]` on a 12px gap, and `w-[104px] sm:w-[244px]` for the
featured row. Ours used to be a breakpoint ahead of that — 124px where the
reference is at 104 — which is a fifth too wide on every phone.

Returns `null` for an empty list rather than rendering an empty heading.

### `Hero`

Two-column banner set directly on the page background — no tinted panel. Black
display type and a single orange call to action on the start side, artwork
bleeding past the gutter on the end side. Below `md` the artwork moves above
the copy and runs full-bleed.

The home page renders it only for a signed-out visitor; once there is a session
`HomeBanner`'s three promo cards take the slot instead. While the session is
still resolving, `Home` holds the space empty rather than picking one, so a
returning player never sees the acquisition pitch flash.

### `HomeBanner`

Three promo cards for a signed-in visitor: **a row on a desktop, a carousel on
a phone**.

From `sm` it is the reference's own markup — `flex justify-between gap-4`, each
card `w-full`, `min-h-[514px] max-w-[496px]` at `xl`. Below `sm` three cards
cannot share a 390px line: they shrink to their min-content width, which is set
by the longest word in each title, so they come out at three *different* widths
(149, 104 and 132px at a 215px viewport, measured on the reference itself) and
still overflow the column. The reference shows one card there instead, ~63% of
the viewport wide (270px on the 428px capture it was measured from) and 410px
tall, its neighbours peeking into the page gutter either side, with three dots
under it — 8px on a 16px pitch, `trunks` for the current one and `trunks/40`
for the rest — advancing every 5s and wrapping round for ever.

One DOM serves both. The scroller stops scrolling at `sm`
(`sm:overflow-x-visible`, `sm:snap-none`), the dots go `sm:hidden`, and what is
left is the reference's row.

Three things are worth knowing before touching it:

- **The loop is three copies of the set**, not one, and the scroller rests in
  the middle one. Anything that leaves that copy — a swipe, an advance — is
  walked back by one copy's width once the scrolling stops, which is invisible
  because the copies are identical. The two spare copies are `aria-hidden` and
  out of the tab order, so assistive technology sees three cards.
- **Every measurement goes through `getBoundingClientRect`**, never `scrollLeft`
  against `offsetLeft`: under RTL `scrollLeft` runs negative, and offsets from
  the scroller's own centre need no sign.
- **A `ResizeObserver` owns the resting position.** The track's width is not
  settled when the mount effect runs — the page grows a scrollbar as the rails
  below render, taking 15px off it — and under `snap-mandatory` the browser
  then re-snaps to whatever is nearest in the new layout, which lands a whole
  card out. Re-centring on every size change is what fixes that, and it covers
  rotation and the `sm` boundary for free.

### `CategoryStrip`

Scrollable category shortcuts. Fixed 96/112px tiles. Sits below the game rails
rather than under the hero, which is where the reference puts the equivalent
row.

### `PromoGrid`

Three promo cards, one column on mobile and three from `md`. Each is a
gradient panel with a decorative circle that scales on hover.

### `ProviderRail`

Greyscale wordmark strip — no cards, no borders, no game counts. Marks are
generated placeholders, not real studio logos.

Its position on the home page follows the session: directly under the hero for
a signed-out visitor, at the foot of the column below the editorial panel once
there is a session. `Home` owns that ordering; the component only draws the
band.

Marks rest at `opacity-40` and snap to full on hover with no transition —
the reference's `h-10 opacity-40 hover:opacity-100` verbatim.

### `LatestWins`

```tsx
<LatestWins />   // takes nothing; reads two public socket events
```

The live wins ticker, over `LAST_BETS` and `TOP_WINNERS`. Two tabs in the
`Rail` header, and they are genuinely two lists rather than one sorted twice:
each is twenty rows off a much longer table, so the biggest win of the day is
very unlikely to be among the twenty most recent.

Both feeds are read even though one is shown. `enabled: tab === …` would make
the first press of the other tab a cold fetch with an empty rail under it, on a
strip whose whole job is ambient movement — and two twenty-row reads on a
twenty-second poll sit well inside the public bucket’s forty-per-ten-seconds.

**It renders nothing until somebody wins**, and treats a failure the same way,
for the reason `ProviderRail` does: this is ambient colour on a lobby page, and
an alert where a ticker should be draws far more attention to the outage than a
missing strip does. That includes a socket that never connects.

It shows the player’s name, which is why it reads the socket rather than
`GET /casino/bet-history/live` — that route deliberately carries no identity,
and a wins strip without a name on it is a list of numbers.

### `RecentRounds`

```tsx
<RecentRounds game="limbo" title="Limbo" />
```

Everyone’s recent rounds on one game, over `LAST_BETS_BY_GAME`. Same event and
same rows as the ticker, opposite filter: this shows **losses too**, because on
a game page a table of nothing but wins beside a Play button is a claim about
the game.

`game` is the ENGINE key from `parameters.event` — `limbo`, not `limbo-original`
and not `Limbo`. An unknown key answers an empty list with no error anywhere, so
the panel renders only for a game `isPlayable` has already vouched for;
otherwise it would be a permanently empty table that looks like a quiet game.

### `TournamentCard`

One tournament on `/tournaments`. Values are read off the reference's own DOM,
not a screenshot: `h-[24.625rem]` and `max-w-[36.125rem]`, `p-4`, 12px radius,
`gohan`; `grid-rows-[1fr_1fr]` puts a `h-[11.375rem]` `object-cover` banner over
a two-column body; the prize panel is `goku` at `h-44`, `px-4 py-5`, and the
countdown tiles are 40px `gohan` squares under 8px captions.

Fixed height, not content height, so a rail of them stays on one baseline —
which is also why the title is `line-clamp-2`. The finished state is
`grayscale(1)` over the **same** artwork plus a `popo` badge in place of the
`roshi` one; there is no second image per tournament.

Neither control works yet, and they are inert differently. `Opt in` is a real
`disabled` button — there is no `bonus` service to post an entry to. The arrow
would open `/tournaments/<slug>`, a detail page this project has not built, so
it is a `span` with no role and no tab stop rather than a link to a 404. See
`docs/11`.

### `ThemeRail`

Curated-collection row. Tiles are landscape (16:9) rather than the portrait
ratio used for games, because they link to collection pages, not titles. Sits
between "Exclusives" and "Crash" on the home page, matching the reference.

**No hover treatment**, matching the reference: its theme cards wrap a bare
`absolute inset-0` link over the artwork and carry no hover class, on the card
or on any thumbnail inside it. The `GameCard` veil is the only hover state on
the reference home page, and keeping it exclusive to game tiles is what makes
it read as "this one is playable".

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
| `Category` | Game list for a category or a `COLLECTIONS` slug; owns the provider filter, derived from the studios actually present |
| `Providers` | Studio index grid |
| `Provider` | One studio's catalogue; owns the category filter, derived from the categories actually present |
| `Play` | Breadcrumb, similar-games rail, unknown slugs — and one of **three** frames, chosen by what the game is. A playable original renders `LimboGame` (a real socket round on casino-service against the wallet); an original this client cannot yet draw says so, because the engine plays all twenty and only the client is missing; an aggregator title renders `ProviderFrame`, whose Fun/Real pair calls `POST /casino/gis/launch{,-demo}` and shows `GIS_NOT_CONFIGURED` as a state rather than a failure. `isPlayable` in `queries/play.js` is the single place that choice is made |
| `LimboGame` | The first in-house original. Stake and target multiplier, a string-safe ½/2×/Max, the payout preview net of the 2% house edge, the settled roll, and the player's own rounds read back from `GET /casino/bet-history?source=inhouse`. It does **not** claim provable fairness: `in-house/engine/hash.js` draws the hash alongside the result rather than committing to it beforehand, so the value is labelled as the round's identifier and nothing more |
| `ProviderFrame` | The aggregator seam. Nothing is launched until a button is pressed — a launch writes a `gis_sessions` row and records a play. The iframe is sandboxed without `allow-same-origin`, so a provider page cannot reach this origin's storage and the access token in it |
| `Refer` | `/profile/refer-a-friend` — the invite banner, the three-step explainer with its dotted connector, and a split between the referral list and a column of statistics and FAQ. The link, `Total Referrals` and `Total earned` are real: `GET /profile/referral`, `GET /affiliate/team`, `GET /affiliate/rewards` |
| `Security` | `/profile/security` — three cards. The password card opens a `Change password` dialog over `POST /auth/change-password`. The two-factor card drives `/2fa/{status,enable,setup-verify,disable}` through a setup dialog (QR plus the base32 key, then a six-digit confirm) and a disable dialog that takes the code **and** the account password; it reads `hasInitiated` so an abandoned setup is a state it can name. The sessions card is `GET /auth/sessions` with a sign-out-everywhere over `POST /auth/logout {allSessions}` — the reference has no such card, and `docs/11` records the divergence |
| `Transactions` | `/profile/transactions` — three tabs over `GET /user/history` (two separately-counted sides, not a flat list) and `GET /user/history/transfers`. Offset-based paging with Previous/Next, because `count` is per-side and no single total would be honest across the tabs. An unresolvable provider coin id renders as `coin #1280` rather than being guessed into a ticker |
| `KycDialog` | The identity submission — the app's only multipart post. Which file slots appear follows the chosen document type. `api.js` omits the content-type on a `FormData` body; setting it answers 500, not a validation error |
| `Dialog` | The shared modal shell: overlay, panel, Escape, focus return to the opener, body-scroll lock, and one animation frame of grace before unmount. Five callers. No focus trap — `aria-modal` does the part that helps, and a half-built trap that misses a control silently swallows Tab |
| `Boosts` | `/profile/boosts` — the Casino Boost list. The reference's empty state is reproduced exactly and is what renders whenever nothing is live; the boost card itself is ours, because the account measured had no boost to copy. `Read more` opens the help-centre article on the page rather than pointing at a help centre this project does not have |
| `Loyalty` | `/loyalty` — the Loyalty Club sheet: full-bleed hero, six benefits, the seven-tier table, a three-way profits picker and four progress cards. Reached from the account menu's `Loyalty` row and the account tab bar's `Loyalty` tab, both of which leave `/profile` behind exactly as the reference does |
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
