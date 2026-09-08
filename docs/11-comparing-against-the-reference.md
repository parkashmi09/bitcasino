# Comparing against the reference, in a browser

**Before calling any screen "done", open bitcasino.io and this app side by side
in Chrome and compare them.** Not from memory, not from the screenshots in
`docs/`, not from the class names in a stylesheet chunk — from both pages, live,
at the same viewport width.

This page is the procedure. It exists because the signed-in header was built
once from a careful reading of the reference's CSS and shipped looking
obviously wrong: the controls were 44px on an 8px radius where the reference's
are 40px on a 12px radius, the wallet was welded to the right-hand cluster
where the reference floats it between two `flex-1` slots, `Recents` was an
unlabelled clock where the reference writes the word out, and the account
control was an avatar chip where the reference has a plain icon. Every one of
those was visible in two seconds of looking at the two pages together, and
none of it was visible in the source.

---

## 1. Open both

```
tab 1   https://bitcasino.io/          the reference, signed in
tab 2   http://localhost:5173/         this app, signed in as a seeded player
```

Both must be in the **same signed-in state**. The header is four controls when
signed in and two when signed out, so comparing a signed-in reference against a
signed-out local build compares nothing.

`curl` is not an option: the site answers **403** to anything without a browser
fingerprint, and the signed-in header does not exist without a session anyway.
It has to be a real Chrome tab.

## 2. Screenshot both, then stop trusting the screenshots

A screenshot tells you *where to look*. It will not tell you whether a control
is 40px or 42px, and the capture scale does not always match the CSS viewport,
so measuring pixels off a screenshot measures the screenshot.

Look at the two images, list what differs, then go and **measure** each one.

## 3. Measure, from both DOMs

This is the part that actually settles a question. Run the same expression on
each tab and diff the numbers:

```js
const hdr = document.querySelector('header');
const R = (e) => {
  const r = e.getBoundingClientRect();
  const s = getComputedStyle(e);
  return `${Math.round(r.x)} ${Math.round(r.width)}x${Math.round(r.height)} r${parseInt(s.borderRadius)}`;
};

({
  // The header's own children, as `x:width`. This one line catches a whole
  // class of layout mistake — see "slots", below.
  slots: Array.from(hdr.children)
    .map((c) => `${Math.round(c.getBoundingClientRect().x)}:${Math.round(c.getBoundingClientRect().width)}`)
    .join(' | '),
  wallet: R(hdr.querySelector('…')),
  actions: Array.from(hdr.querySelectorAll('button, a')).map(R),
})
```

Read the **`slots` line first.** It is the cheapest high-value check there is:
the reference's header is three children, `517 | 198 | 517`, and a build whose
wallet sits inside the actions group reports something like `507 | 218 | 507`
or no middle child at all. Structure shows up in that string long before any
individual control looks wrong.

Then, for anything that still differs, ask the element itself:

```js
const el = document.querySelector('…');
const s = getComputedStyle(el);
({ h: el.getBoundingClientRect().height, radius: s.borderRadius, bg: s.backgroundColor,
   border: s.border, pad: s.padding, gap: s.gap, fs: s.fontSize, fw: s.fontWeight })
```

`getComputedStyle` is the authority. `backgroundColor` comes back resolved —
`oklab(0.934019 …/0.3)` on both sides means both sides are `hit` at 30%, and no
amount of reading class names would have proved that.

Colours map back to the Moon tokens in `docs/02-reference-analysis.md`:
`#f9f7f6` gohan, `#e9e9e9` beerus/hit, `#f2590d` piccolo, `#e0e0e0` beerus.

### Chase the last two pixels

They are always something specific, and the specific thing is usually reusable:

- **`Recents` was 111px against the reference's 113.** The reference's controls
  carry a 1px transparent border — the same trick `Button.jsx` already
  documents for the rest of the site. A fixed 40px square swallows it; a
  content-width pill does not.
- **The wallet box was 202px against 198.** The reference's coin image carries
  `-m-0.5`: it *draws* at 24px and *occupies* 20px, pulling in the 8px gaps
  either side of it.

Neither was guessable. Both took one `getBoundingClientRect` on each side.

## 4. Read the responsive rules, do not guess them

The reference's own class names say exactly what it does at each width, and the
utility classes survive minification:

```js
const out = [];
(function walk(el, d) {
  out.push(`${d}|${el.tagName}|${(el.className || '').toString()}`);
  if (d < 4) Array.from(el.children).forEach((c) => walk(c, d + 1));
})(document.querySelector('header'), 0);
out.filter((s) => /hidden|md:|xl:|flex-1|justify/.test(s)).join('\n');
```

That is where the header's mobile behaviour came from, verbatim:

| Rule on the reference | What it means |
| --- | --- |
| `hidden md:flex flex-1 items-center` | the search field is desktop-only |
| `block md:hidden` | a logo-only block replaces it on a phone |
| `hidden md:block text-[13px] font-medium` | the Deposit **label** goes at `md`; the glyph stays |
| `hidden xl:block` | `Recents` is gone below 1200px |
| `flex h-10 md:h-11 … rounded-xl border bg-accent px-1 pl-2` | the wallet box, always present |

## 5. Check mobile — the window will not resize

`resize_window` reports success and does nothing when the Chrome window is
**maximized**, and `document.documentElement.style.zoom` does not move the
layout viewport, so media queries do not respond to either. Two ways out:

**Restore the window first** (un-maximize it), then resize. This is the only
way to test the *reference* at a phone width, because it cannot be framed.

**Or probe your own app in a same-origin iframe.** An iframe gets its own
viewport, so media queries inside it resolve against the iframe's width. This
needs no window management and can sweep several widths in one call:

```js
async function probe(w) {
  const f = document.createElement('iframe');
  f.style.cssText = `position:fixed;left:-9999px;width:${w}px;height:700px;border:0`;
  f.src = '/';
  document.body.appendChild(f);
  await new Promise((r) => f.addEventListener('load', r, { once: true }));
  await new Promise((r) => setTimeout(r, 2200));   // let the session bootstrap
  const hdr = f.contentDocument.querySelector('header');
  const out = { vw: f.contentWindow.innerWidth, /* …measurements… */
    overflow: f.contentDocument.documentElement.scrollWidth > f.contentWindow.innerWidth };
  f.remove();
  return out;
}
[await probe(360), await probe(390), await probe(768), await probe(1100)];
```

Sweep **360, 390, 768 and 1100**: the narrowest phone in use, a normal phone,
the `md` boundary, and the width just under `xl` where `Recents` disappears.
Assert `overflow === false` at every one of them — a header that overflows is
the failure this catches, and it is invisible on a 1536px monitor.

Two cautions:

- The iframe shares `localStorage`, so it boots a **second session** from the
  same rotating refresh token. One probe at a time is fine — the same thing
  happens when a player opens a second tab — but do not run several
  concurrently, and remove the iframe when done. See the rotation note in
  `auth/AuthProvider.jsx`.
- The reference sends `X-Frame-Options`, so this technique is for **our** app
  only. The reference's mobile behaviour comes from step 4.

## 6. Write the numbers down where the code is

Every measurement that decides a value belongs in the component's own comment,
with the fact that it was measured. `HeaderMenu.jsx` carries the trigger
geometry, `WalletMenu.jsx` the wallet box's, `Header.jsx` the three-slot
structure. A number in a comment survives; a number in a chat message does not,
and the next person to touch the file will otherwise "tidy" 40px back to the
44px the rest of the site uses.

---

## Where we deliberately differ

Matching is the default, so the exceptions have to be written down. As of the
signed-in header:

| The reference | Here | Why |
| --- | --- | --- |
| Real coin artwork from `cashier-module.imgix.net` | A tinted disc with the ticker's initial | Those are the coins' trademarks |
| A live notification feed behind the bell | Three fixed rows from `data/notifications.js` | No feed route exists in user-service — `club-broadcasts` and the `social` socket are neither of them this. Same seam as `catalog.js`. The pip is real either way: it counts unread rows and `Mark all as read` puts it out for good |
| The account menu's nine rows all lead somewhere | `Loyalty`, `Rewards`, `Boosts`, `Account`, `Tournaments`, `Notifications` and `Log out` do; the other two are `aria-disabled`, with no hover fill and no tab stop | Those are the account area in Phase 6. They paint exactly as the reference draws them — greying them made the panel read as half broken — so the difference is in what they do, not how they look. The account tab bar follows the same rule |
| A live loyalty tier, multiplier and points total in the card | Fixed values from `data/loyalty.js` | The platform in `backend/` has no loyalty service — `modules/club` is the affiliate club, not a player tier. Same seam as `catalog.js` |
| Unread counts on `Rewards` and `Tournaments` | No badges | Nothing here counts anything. `MenuRow` takes a `badge`; no caller passes one yet |
| An unread row is marked by something in a slot above the message | A 6px `piccolo` dot in the page gutter | Their slot is `750x0` on a read row, so its unread form could not be measured on the account we had. The dot keeps the one thing that IS measured exact — the message's left edge at the column start, read or not |
| A live bonus list on `/profile/rewards`, and a server-checked claim code | One fixed offer from `data/rewards.js`, plus two fixture codes `useRewards` redeems into `localStorage` | The platform in `backend/` has no bonus service — nothing in `lib/endpoints.js` answers a reward list, an enable call or a redemption. Same seam as `catalog.js`. `Enable` and `Claim reward` are real against that store, so both controls do what they say rather than being pictures of controls |
| The reward card's `Deposit` opens the cashier for that bonus | It opens the header's own deposit drawer | There is nothing bonus-specific to pass it — the drawer is the same surface either way |
| The account pages share one 750px reading column | Notifications keeps 750px; Rewards runs the full width of `main` | It is the reference's own split: Notifications is a list and Rewards is a card grid. The cap therefore lives on the page, not on `ProfileLayout`'s outlet |
| Reward columns counted off the viewport | Counted off the container — `auto-fill` over `minmax(min(320px,100%),1fr)` | The 240px sidebar means the content column is far narrower than the viewport, so a `sm:` rule for two columns puts two 224px cards side by side at 768px and breaks the card title over five lines. Container-measured, the card holds 273px at a 320px phone and 390px at 1536 — the reference's ~380px |
| Nine editable fields on `/profile/account`, all persisted | Country goes through the real `PUT /user/profile`; the other eight persist in `localStorage` | `PUT /user/profile` is `.strict()` and accepts `username`, `country` and `avatar` only — there is no column on the platform for a first name, an address or a Telegram handle, and an unknown key is a 422 rather than a silent drop. `useProfile` holds the split and names every field on each side of it |
| The phone number is stored split into a dialling code and a number | `GET /user/profile` answers one `phone` string, which the form splits on load | The platform has one column. The split is re-derived only while the browser-held half is empty, so a saved edit is never undone by a reload |
| A date of birth on the account record | The row is drawn and prints an em dash | Signup collects a birthday and the platform accepts no field for it, so nothing has one to show. The row stays because the reference always draws it |
| A live "verify your account" notice | Built, but driven by a fixture flag | Nothing in `backend/` reports email-verification state: `GET /profile` has no flag and the email module's routes are OTP issue/verify, not a status read. Marked as the one fixture in `useProfile` |
| `Start verification` opens a KYC document flow, and the notice can resend the email | Both are `aria-disabled` with a title saying so | Submitting is a multipart upload against `POST /user/kyc/submit` and belongs to its own screen; resending has no route at all. The card around them is real — `GET /user/kyc/status` decides whether it shows, and `Pending`/`Rejected` change its closing line |
| The account form gives no feedback on save | A live region under the button says `Saved.` or prints the failure | `PUT /user/profile` can genuinely fail, and a form that says nothing either way leaves the player guessing. The addition is one line of text and no chrome |
| ~250 country names written into the page | Resolved from ISO codes through `Intl.DisplayNames`, pinned to `en` | Same list, a quarter of the bytes, one source of truth. `en` is pinned for the reason the dates are: the reference serves one set of names to everyone |
| `Change Currency` opens the reference's wallet modal | It swaps the row's read-only value for a select in the same 40px box | The reference's wallet modal has no twin here, and this app already edits that value from the header. Building a second picker in front of one store would be two pickers for one value; the row keeps the reference's geometry either way |
| Three subscription switches, all persisted | `Email` is a real `PATCH /user/preferences`; `SMS` and `Call` persist in `localStorage` | `userconfig` has `emailNotifications` and `pushNotifications` and no column for SMS or a phone call. `usePreferences` holds the split. The PATCH carries one key, so ticking a box cannot write back `theme`, `language` or `pushNotifications` — values this page never showed |
| `Preferred FIAT currency` is stored on the account | A shared browser preference, `bc.fiat` | No column: `userconfig` has theme, language and the notification flags only. It is not inert, though — it drives the footer's `1 USDT = …` pair against real rates from the public `GET /user/exchange-rate/rates`, which was a hardcoded `1 USDT = 1 USD` before this page existed |
| A styled `<button>` standing in for each checkbox | A real `appearance-none` `<input type="checkbox">` | Same 16px box, same 4px radius, same `piccolo` fill — but the native control keeps its keyboard contract and label association instead of reimplementing both |
| No feedback when a subscription switch fails | A live region under the switches, hidden while empty | `Email` is a real round trip, and a box that silently flips back is worse than a line saying why. `empty:hidden` keeps the block at the reference's measured 144px when there is nothing to say |
| The game-list heading is Space Grotesk at `font-light` | DM Sans, 24px/32, weight 400 | It always was on the reference — `getComputedStyle` on the `h1` of both `/categories/video-slots` and `/games/recent` reads back `24px/32px`, weight `400`, `"DM Sans"`. `GameList` had it as the display face; that was ours, not theirs, and it is fixed. Category, Provider and Recently played all changed together |
| A `[★ 0] [Recents 0]` row in the sidebar | Built, with the star inert | `/games/recent` exists, so the Recents chip is a real link to the same page the header control opens, and its badge is the length of that page's own list. The star has no destination until there is a favourites feature, so it renders as a readout — no role, no tab stop, no hover — and its `0` is true rather than a placeholder || No header search below `md` | A search icon stays | The reference puts search in a bottom tab bar this project does not have |
| The balance stays visible at every width | Drops below `sm` | Same reason: six 40px controls plus the amount overflow a 360px phone, and the amount is one tap away in the panel |
| `shrink-0` on the search pill | It shrinks | Theirs overflows at the `md` boundary; ours does not |
| The refer page’s split band has no responsive classes at all — `flex gap-4` with a `w-2/5` column and a `min-w-[402px]` FAQ card | It stacks below `xl` and is their two columns above it | Measured at a 767px viewport the reference’s own statistics column sits outside the viewport. Two columns is the design; overflowing off the screen is not |
| The dotted step connector is a sibling above the list, with a fixed `h-52` on its vertical run | Inset off the list — `start-4` and `top-10` | Positioned their way the rule lands 24px above the badge centres instead of through them, and the fixed height is tied to the exact length of their step copy |
| The three steps are content-sized, so their badges sit 414px and 359px apart | Equal widths at `md` (`md:flex-1`) | The rule the reference centres between them therefore overhangs one end more than the other. Equal columns put the badges on an even pitch and the rule symmetric about them |
| The invite link is `bitcasino.io/ref/<code>` | `<origin>/ref/<code>`, redirecting to `/register?ref=<code>` | Built off `location.origin` rather than the platform’s own `referralLink`, which is `<PUBLIC_SITE_URL>/referal/<code>` — the backend’s origin and the backend’s spelling, neither of which is where this app is served from. `App.jsx` keeps the reference’s URL shape and lands it on the form `SignUp` already resolves `?ref=` against |
| A 30-day progress bar per referral once there are any | Only the empty state, with the count and the amount in the statistics column | `GET /affiliate/team` answers members, but the platform reports no per-referral progress: `Rewards` rows carry an amount and a date, not a points total against a 30-day window. A bar animated to a number we invented would be the one thing on this page that is not real |
| The security page’s two cards are styled differently from each other — `h4.text-xl` 20/28 weight 400 over `border-t border-beerus/60`, then `h3.text-lg` 18/28 weight 500 over `h-px bg-beerus` | Both reproduced exactly as measured | It reads as one repeated card and is not one. Reproducing it keeps the two pages identical; anyone unifying the pair should know the difference is theirs, not a mistake here |
| The 2FA switch turns 2FA on and off | It reports `two_fa_status` from `/auth/me` and is `aria-disabled` | `modules/auth` serves `me`, `sessions`, `logout` and `change-password` and nothing else; the only 2FA path on the platform is `POST /email/2fa/reset`, a public recovery flow rather than a setting. `docs/10` has `POST /2fa/enable` under Phase 6. The switch paints as the reference draws it and is told apart by what it does, not by how it looks |
| Their `Change password` dialog says the password needs at least 7 characters including a number or a capital | Ours says at least 10 characters | The validator behind `POST /auth/change-password` is `min(10).max(200)` with no composition rule. Copying their line would be a rule the form then contradicts — a 9-character password with a capital would pass the page and fail the server |
| Their dialog warns that changing the password blocks withdrawals for 48 hours | Ours says it signs you out on every device | The 48-hour hold is the operator’s policy and is not implemented here. What `auth.service.changePassword` actually does is revoke every session for the account, the caller’s included — so the success state says that and offers `Sign in again` rather than leaving a dead refresh token behind |
| Their new and confirm password fields are one grouped box with placeholders and no labels | Three separate fields, each with a visible label | The grouped box loses the field name the moment anything is typed into it. The labelled form is the one `Account.jsx` already uses on the sibling page |
| No gap between `App Authentication` and `Inactive` — the reference renders `App AuthenticationInactive` | One space between them | Two adjacent spans with no separator. It reads as one word on their page |
| `/profile/boosts` is one empty-state card and nothing else | The same card, plus a boost card when there is a boost, plus a `How Casino Boosts work` disclosure | The empty card is reproduced exactly and is still what renders when the list is empty. The account we measured had no boost, so the populated card is OURS — its five facts are the reference's own model, from its help centre, and its chrome is `RewardCard`'s so the two account pages read as one system |
| The boost card would carry an `Activate` | It links into the eligible category instead | The reference starts a boost from the button beside the timer UNDER a boost-compatible game, not from the account area. An `Activate` here would be a running timer with no service behind it |
| `Read more` opens `/help-center/help-your-bonuses/casino-boosts` | It opens the article's substance at the foot of the page | This project has no help centre, and a button pointed at a route that does not exist is worse than one that answers the question in place |
| The empty card's button is `mt-8 xl:mt-0 xl:ml-auto` | `mt-8 lg:mt-0 lg:ms-auto` | Theirs leaves a 176px band, `lg` to `xl`, where the card is already a row but the button has not moved to the end yet: measured at 1103px the subtitle ends at x=757 and the button starts at x=757, touching. Identical to the reference at the 1536px it was measured at |
| `/loyalty`'s three "Find out your Loyalty level" buttons | An anchor to the tier table on the same page | Theirs carry no href and no visible handler, so there is no destination to copy. The tier table is the question the button asks |
| Nothing on `/loyalty` says which tier you are on | The matching tier card carries a `Your level` pill, from `LOYALTY` | Ours, not theirs — it is what makes that button answer anything. The slot is on every card and `invisible` on six, so the facts still line up across the row |
| The benefit and progress rows ship twice — a carousel and a grid, one of them `hidden` | One row that changes `display` at `xl` | Same result, half the DOM, and the two cannot drift apart |
| The whole `/loyalty` page is forced light (`theme-bitcasino-light`) | Only the hero is (`theme-light`) | Only the hero needs it: its type sits on a pale photograph. The rest is drawn from tokens and follows the app theme |
| The three promise lines under the banner are 16px at every width | 14px below `sm` | Three columns of 16px on a 390px phone breaks "Real money rewards for everybody & no wagering requirement" over seven lines |

## The state as of the last comparison

Measured on **2026-09-08**, both tabs at a 1536px viewport, both signed in.
Every one of these is identical on both sides:

```
header children   272:517 | 789:198 | 987:517
wallet box        789   198x40  r12
  balance button        83
  Deposit         890    93x32  r8
Recents          1300   113x40  r12
Notifications    1419    40x40  r12
Profile          1465    40x40  r12
header height            64
```

Re-run step 3 after touching the header and this block should still hold.

The **account panel**, opened from that Profile button. Measured the same day
and the same way, and identical on both sides down to the row positions:

```
panel            1217,60  288x507  r8  pad4    (no scrollbar either side)
greeting band    1221,64  280x36   r8  pad8
loyalty card     1221,104 280x90   r8  pad8
  tile           1229,112  44x50   r8  pad 6/4
  facts          1281,112 212x50   r8  pad 8/12
  progress       1229,170 264x16
rows             1221,203 280x40   r8  pad10  gap12  fs14
                 …then every 40px: 243 283 323 363 403 443 483, Log out 523
```

**`/profile/notifications`**, which the header bell links to. The bell is an
`<a href="/profile/notifications">` on the reference, not a menu trigger — this
project opened a dropdown from it, which is the whole reason the two screens
looked nothing alike. Both sides at 1536px, signed in:

```
tab bar          288,104  1201x50   flex, 16px gap, 14px padding-bottom
  tab                       14px/1.3, weight 400
  resting                   trunks
  active                    bulma over a 2px piccolo bar, label width
heading          288,154   750x32   24/32, weight 400, DM Sans, no tracking
Mark all as read 288,196            16px piccolo
row message      288,226   750x21   14/21, bulma
row date         288,247   750x16   12/16, UPPERCASE, 0.3px, bulma
row rule         288,263   750x1    beerus
                                    → 21 + 16 + 1 = a 38px row, no gaps
bell             1419,12    40x40
```

The date is `bulma`, not a muted token. It reads grey and it is not —
`getComputedStyle` says `rgb(0,0,0)` at opacity 1, and 12px uppercase on 0.3px
tracking is what does it. Worth knowing before somebody "fixes" it.

The tab bar **scrolls sideways**; it does not wrap. Nine tabs measure ~690px, so
they do not fit a phone, and the reference's own `<ul>` carries `overflow-x:
auto`. Probed through the step 5 iframe at 360/390/768: the bar's `scrollWidth`
is 691 against a 313/343/433 client width every time, and the page itself never
overflows.

The account panel's **mobile** form is a different shape, not a narrower one — below `sm` it is
a full-bleed sheet under the header rather than a floating card. Probed through
the step 5 iframe at 360/390/639/640, with `animate-menu-in` stripped off the
panel first (an offscreen iframe does not tick animations, so measuring one
mid-keyframe reports the 95%-scale opening frame):

```
vw 360   fixed    0,60  345x507   radius 0 0 8 8      no overflow
vw 390   fixed    0,60  375x507   radius 0 0 8 8      no overflow
vw 639   fixed    0,60  624x507   radius 0 0 8 8      no overflow
vw 640   absolute 321,60 288x507  radius 8            floating card
```

And the home page's **section order**, which is the same check one level up.
Walk the main column's children on each side and print `index, y, height, label`:

```
              reference                    ours
banner        104   514                    104   514
rail 1        650   240   Originals        618   264   Originals
              …six more rails, Themes seventh, same order both sides…
editorial    2926   300                   2696   300
                —                         3020   332   Testimonials   <- ours only
studio       3258    80   LAST            3352    80   LAST
```

The strip being **last** is the thing to re-check. It sat directly under the
banner here for a long time on the strength of a comment claiming the reference
put it "under the hero" — it does not, anywhere, and one `Array.from(col.children)`
dump settled it. Ours carries one band the reference's column does not
(`Testimonials`); the rail heights differ by 24px and `Themes` by 110px, both
still open.
