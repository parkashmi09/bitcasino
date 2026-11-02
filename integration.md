# Handover: linking backend, owner panel, admin panel and player site

Written 2026-10-28 from the rainbet repo (`CFZ-Technologies/rainbet-main`),
where this work is done and tested. Use it to do the same linking in another
site built on the same platform (bitcasino, smartbet, …).

**What is shared and what is not.** `backend/`, `admin/` and `owner-panel/`
come from `CFZ-Technologies/hash-game-exchange` (source of truth, branch
`main`) and are the same code in every site. Each site has its **own player
frontend**. So: the backend/admin/owner steps below carry over as-is; the
frontend steps describe *what* to wire and *how rainbet did it* — adapt the
code to the target frontend's own structure, don't copy rainbet's files.

Rules that apply in every site:

- Never edit hash-game-exchange. Changes to `backend/`, `admin/`,
  `owner-panel/` in a site are local divergences and must be re-applied after
  every sync (that repo's `hash-sync` skill keeps a KEEP list).
- Never commit `.env` / `.env.local` files. Committed `.env.example` files
  keep hash's values.
- Read the code before trusting any doc — older integration docs in these
  repos went stale within weeks.

---

## 1. The four parts and how they talk

| Part | Dir | Dev port | How it reaches the backend |
| --- | --- | --- | --- |
| Gateway | `backend/gateway` | `GATEWAY_PORT` (rainbet: 4000; `.env.example`: 4700) | — |
| Services | `backend/services/{user,admin,casino,sports}` (+ sports-worker, user-worker) | gateway+1…+4 | Postgres |
| Player site | `frontend/` | Vite 5173 | dev proxy `/api` → `VITE_GATEWAY_URL` |
| Admin panel | `admin/` (Next.js) | 3110 | browser → `/api/gw/*` route handler → `API_URL` with staff JWT from an httpOnly cookie; login posts straight to the gateway (`NEXT_PUBLIC_API_BASE`) |
| Owner panel | `owner-panel/` (Next.js) | 3115 | server-side only: `SITE_GATEWAY_URL/api/v1/admin/owner/*` with header `x-owner-key` |

Gateway routing (`backend/gateway/src/app.js`, longest prefix first):
`/api/v1/admin/user` → user, `/api/v1/admin/casino` → casino,
`/api/v1/admin/sports` → sports, `/api/v1/admin` → admin,
`/api/v1/user` → user, `/api/v1/casino` → casino, `/api/v1/sports` → sports,
`/socket.io` → user, websockets at `/ws/<svc>/socket.io`.

Every response: `{ success, data, meta? }`, errors
`{ success:false, error:{ code, message, details } }`.

**Owner vs admin.** The owner decides what the site is *entitled* to
(features, policies, coins, branding, colour template, admin theme). The admin
panel operates inside that. Owner saves are Ed25519-signed documents stored in
`owner_entitlements` / `owner_audit`; the admin service applies them to
`site_features` etc. and re-polls every `OWNER_POLL_SECONDS` (15). There is no
owner database account — owner login is env credentials.

What the player site reads from owner/admin (all public, no auth):

| Route | Gives |
| --- | --- |
| `GET /api/v1/admin/features/public` | `[{ feature, kind?, variant, options? }]` — the `theme` row is the colour template; policies like `default_currency`, `theme_mode` |
| `GET /api/v1/admin/site-config/public` | flags and rates; `defaultCurrency` (owner's Default coin) |
| `GET /api/v1/admin/branding/public` | `{ branded, siteName, title, description, themeColor, logoUrl, markUrl, ogImageUrl, … }` (15 s cache) |
| `GET /api/v1/admin/branding/asset/:file` | the uploaded images (immutable, hash-named) |
| `GET /api/v1/admin/banners`, `/admin/promotions`, `/admin/blogs` | admin-managed content |

---

## 2. Phase 1 — boot everything and sign in on all three

### Environment checklist (the mismatches we hit)

1. **One gateway port everywhere.** Backend `GATEWAY_PORT` + the four
   `*_SERVICE_PORT`/`*_SERVICE_URL`; frontend `VITE_GATEWAY_URL`; admin
   `API_URL` and `NEXT_PUBLIC_API_BASE`; owner `SITE_GATEWAY_URL`. The
   frontend's code default may be 4000 while `.env.example` says 4700.
2. **CORS.** `CORS_ORIGIN` and `SOCKET_ALLOWED_ORIGINS` in `backend/.env`
   must list the real dev origins: the player site (`localhost` *and*
   `127.0.0.1`), the admin panel (3110), the owner panel (3115). The example
   file lists old ports. Without the admin origin, admin login fails in the
   browser (it posts cross-origin to the gateway).
3. **Owner keys.** Private key `OWNER_SIGNING_KEY` (owner panel) must match
   public key `OWNER_VERIFY_KEY` (backend). Check:
   ```js
   const c = require('crypto');
   const priv = c.createPrivateKey({ key: Buffer.from(SIGNING, 'base64'), format: 'der', type: 'pkcs8' });
   c.createPublicKey(priv).export({ format: 'der', type: 'spki' }).toString('base64') === VERIFY
   ```
   Generate a pair with `owner-panel/scripts/owner-keys.mjs`.
   `OWNER_SHARED_SECRET` identical on both sides (unset = every owner call 401).
4. **Site key.** Backend `OWNER_SITE_KEY` = owner `SITE_KEY` = admin
   `NEXT_PUBLIC_SITE_KEY`, set to the site's own key (rainbet: `rainbet`). Change
   all three together, before the first owner save. Site names:
   owner `SITE_NAME`, admin `NEXT_PUBLIC_SITE_NAME`.
5. **Postgres.** Use the matching `pg_dump` version for backups (server 18
   needs `pg_dump` 18).

### Database

```bash
cd backend
npm run db:status        # pending migrations after a hash sync
npm run db:migrate
npm run setup            # fresh DB only: migrations + bootstrap seeders (first Super Admin from SEED_ADMIN_*)
npm run db:seed:demo     # demo players/staff + game catalogue (gisgamesnew, js_games, collections)
```

Fresh player data (deletes every `demo_*` player and staff account and all
their rows, children first, one transaction; dry run without `--yes`):

```bash
node scripts/seed-data.js --reset-demo          # dry run, prints counts
node scripts/seed-data.js --reset-demo --yes
```

Non-demo test players are not covered; to include them, prefix their email
with `demo_` first. **Back up before** (`pg_dump -Fc`).

### Start

```bash
cd backend && npm run dev                  # gateway + services + workers
cd admin && npm run dev                    # 3110
cd owner-panel && npm run dev              # 3115
cd frontend && npm run dev                 # 5173
curl http://127.0.0.1:<gateway>/health     # every service "ok"
```

On Windows, stopping `npm run dev` can leave child processes listening; free
the ports (`netstat -ano | findstr LISTENING`, `taskkill /PID <pid> /F /T`)
before restarting.

### Admin sign-in gotchas

- Seeded Super Admin: `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`
  (defaults `admin@ibitplay.local` / `ChangeMe!2026`). Change the password in
  the admin panel at **My account** (`/account`) — the panel only forces it
  when the backend flags `mustChangePassword`, which the seed does not.
- Login refused with `STAFF_AUTH_TWO_FACTOR_ENROLMENT_REQUIRED`: roles at or
  above `STAFF_2FA_REQUIRED_LEVEL` (default 3) need TOTP.
  `npm run staff:2fa:bootstrap` only runs when `DB_NAME` looks like a dev copy
  (`test|dev|local|staging|…`). Otherwise set `STAFF_2FA_REQUIRED_LEVEL=0`
  in `backend/.env` **temporarily** (documented local-dev switch), sign in,
  enrol 2FA at `/account`, remove the switch, restart. Never leave it on a
  server.
- Rate limits: `AUTH_RATE_LIMIT_MAX` and `LOGIN_MAX_ATTEMPTS` lock accounts
  after a few failures — read the error body instead of retrying.

### Owner panel

- Sign in with `OWNER_USERNAME` / `OWNER_PASSWORD`.
- **Features & plan** (`/entitlements`): template (colour theme), admin
  theme, policies (Default coin, theme mode, …), features. **Save once** —
  until then `GET /admin/owner/entitlements` returns `version: 0, doc: null`
  and no `theme` row is published.
- **Branding** (`/branding`): site name, logo (wordmark, PNG/WebP/SVG, wider
  than ~1.5:1), mark (square), social image, title, description, theme colour.
- Default coin is an **owner-only** setting by design; the admin panel only
  displays it (`admin/src/components/shared/DefaultCurrency.tsx`).

### Phase 1 done when

Health all `ok`; admin signs in and Dashboard loads; owner signs in and
Overview shows gateway/admin/frontend healthy and a save works; on the player
site a new player registers, signs in, sees a balance and live games.

---

## 3. Owner branding → admin + player site

- Admin panel already follows it (`admin/src/components/shared/BrandMark.tsx`
  reads `admin/branding/public`).
- Player site (rainbet: `frontend/src/lib/branding.js`):
  - one cached read of `/admin/branding/public` per page load;
  - `useBranding()` returns `{ siteName, alt, logoUrl, markUrl, title,
    description, themeColor }`, each field falling back to the site's bundled
    art when the owner has not set it (`branded:false` → all bundled);
  - used by header logo + mark, footer logo, any other logo spots;
  - `BrandingHead` (mounted once at the app root) sets `document.title`,
    meta description, meta theme-color, and the favicon (`markUrl`).
  - Give owner logos `object-fit: contain` — their aspect ratio differs from
    the bundled art.
  - Leave marketing/SEO prose that names the brand alone unless asked.

## 4. Owner colour template → player site

The owner's Template (Features & plan) is published as the `theme` row of
`/admin/features/public`. `hash_game` = "Original" = the site's own colours.
The admin panel applies it via `admin/src/components/layout/PaletteSync.tsx`
and the palette blocks at the end of `admin/src/app/globals.css` (16 keys:
`carbon_gold violet_night emerald_dark neon_navy lapis_ledger seashell_teal
navy_coral indigo_mint cobalt_citrine copper_harbour wisteria jade_night magma
royal_dusk tangerine_field ocean_ruby`). Each palette has dark values
`--pal` (accent), `--pal-on` (text on accent), `--pal-bg`, `--pal-card`,
`--pal-border`, `--pal-input`; the twelve designer ones also `--foreground`,
`--muted-foreground`.

A player frontend usually hard-codes its colours, so a palette cannot apply
until colours become variables. Rainbet's approach (`frontend/scripts/palettes.mjs`):

1. **Inventory** colour literals in the CSS (`--report`). Classify in OKLCH:
   *ramp* = the site's surface→text family (navy→lavender for rainbet),
   *accent* = the brand button colour family, everything else (white, black,
   overlays, green/gold/red status) untouched. Tune the hue/chroma thresholds
   in `family()` and the anchors in `RAMP` / `ACCENT_REF` to the target site's
   own colours (ground, card, border, input, muted text, text, accent).
2. **Codemod** (`--codemod`, one-off): every themeable literal in a CSS
   declaration value → `var(--rbc-<hex>[-a<alpha>])`. Skips comments,
   `url(...)` values and `@property initial-value` (must stay literal —
   lightningcss fails the build otherwise).
3. **Generate** `src/styles/rainbet-palettes.css`: `:root` gives each variable
   the site's exact original value (default site unchanged), and each
   `html[data-palette='<key>']` block gives the mapped value: ramp colours are
   interpolated between the palette's anchors by lightness, accent colours take
   the palette's accent hue at the same relative lightness. Existing HSL design
   tokens (rainbet: `--rb-gojo/yuta/primary-*`) are overridden the same way.
   Re-run after a hash sync that changes `globals.css`.
4. **Text on accent.** White text on an accent fill becomes
   `var(--rb-on-accent)` (palette `--pal-on`) — rules found statically by the
   codemod, plus an `ON_ACCENT` selector list for controls whose white text is
   inherited (found by scanning live pages for white text over an accent
   background). Without it, light accents (gold, lime) make buttons unreadable.
5. **Apply.** On load, read `/admin/features/public`, take the `theme` row's
   variant, set `<html data-palette>` (remove it for `hash_game`), store it in
   `localStorage`; an inline script in `index.html` reapplies the stored
   value before first paint (no flash).
6. **Verify.** Capture computed colours (color, background, borders,
   gradients, shadows, fill/stroke) of every element on several pages before
   and after the codemod with headless Chrome — the default must be identical
   (only live-data count noise). Then screenshot 2–3 palettes.

Not themeable this way: raster art (banners, game tiles, photos).

### 4b. Second version (2026-10-29): runtime themes, icons, green buttons, custom themes

What changed after the first version, and why:

- **Runtime instead of static CSS.** The mapping lives in a shared, import-free
  module (`frontend/src/lib/paletteMap.js`) used by both the generator and the
  browser. The generator now writes only `:root` defaults + text-on-fill rules
  (`styles/rainbet-palettes.css`), the variable/token list and built-in
  palettes (`lib/paletteData.js`), and a copy of the built-ins for the owner
  panel (`owner-panel/src/configs/builtinPalettes.ts`). `lib/palette.js`
  builds `html[data-palette]{…}` from colour data at runtime — so built-in and
  owner-made themes take the same path. Re-read `/admin/features/public`
  every 15 s and on `visibilitychange` (the admin panel polls too); reading
  it once on load means a theme change needs a page reload. Cache `{key, css}` in `localStorage`;
  the `index.html` boot script injects it before first paint.
- **Palette shape** everywhere: `{ accent, onAccent, secondary, onSecondary,
  bg, card, border, input, fg, muted }`, 6-digit hex without `#`.
- **Green buttons (secondary family).** OKLCH hue 130–162, chroma ≥ 0.06 →
  the palette's secondary (admin `--brand-secondary`); a grey secondary
  (chroma < 0.05, e.g. magma's) falls back to the accent. White text on green
  fills → `var(--rb-on-secondary)` (codemod + `ON_SECONDARY` list found by a
  signed-in + signed-out page scan).
- **Icons.** No markup changes: a `MutationObserver` in `lib/palette.js`
  (a) fetches same-origin `<img src="*.svg">`, rewrites themeable colours in
  the SVG text, swaps in a `blob:` URL (original kept in
  `data-rb-orig-src`); (b) rewrites inline SVG `fill` / `stroke` /
  `stop-color` attributes (originals kept, restored on "Original").
- **Background art (raster).** Same observer, allowlist `ART` (site folders:
  banners, raffle, kick-drops, page images, auth art, VIP/affiliate
  illustrations) + `REMOTE_ART` (Rainbet CDN partner tile; its CDN sends
  CORS, so it is loaded with `crossOrigin`). Each image is redrawn once per
  palette on a canvas through a 32k-cell RGB lookup and swapped for a
  `blob:` URL; `<picture><source srcset>` and CSS `url()` backgrounds are
  covered (the latter via override rules in `<style id="rb-palette-art">`).
  Art uses its own **continuous** mapping (`mapArtColour` in `paletteMap.js`):
  blue→violet pixels turn toward the palette (muted → ground, vivid →
  accent, blended by chroma; hue spread halved), greens → secondary; greys,
  skin, gold, red untouched. The CSS family mapping is *not* used for
  pixels: its hard edges made blotches in noisy gradients. Game tiles,
  provider logos and sportsbook banners are deliberately not on the list.
  Raster "icons" (3D illustrations) are recoloured the same way — tracing
  them to SVG would lose their shading.
- **Rainbet as "Original".** Player site: no palette = Rainbet's own colours.
  Admin: `PaletteSync` maps `hash_game` → a `rainbet` block at the end of
  `admin/src/app/globals.css`. Owner: Original's swatch/text = Rainbet.
- **Owner-made themes ("Add theme").**
  - Owner panel: `ThemePicker.tsx` replaces the template card grid — swatch
    cards, click → preview dialog of the player site with "Use this theme",
    Add theme editor (name + accent + secondary + background; panels, borders,
    inputs, text, muted, text-on-fills derived in OKLab by
    `lib/themeColours.ts`; Advanced overrides each). Saved in the signed
    entitlements document as `palettes: [{ key: 'custom_…', label, colours }]`
    (`lib/entitlements/palettes.ts` validation; `store.ts` accepts a custom
    template key and refuses deleting the active one; audit kind `themes`).
  - Backend: `entitlements.store.js` `palettesOf()` keeps valid themes,
    `templateOf()` accepts a `custom_*` key present in them;
    `features.service.js` stores it as the template and `publicList()` adds
    `label` + `palette` to the `theme` row. Test in
    `entitlements/__tests__/entitlements.test.js`.
  - Admin: `SessionContext` keeps `theme_palette` (JSON) in the features map;
    `PaletteSync` sets `--pal-*` inline under `data-palette="custom"` so the
    generic `html[data-palette]` rules derive the rest.
- **Verified:** default site computed colours identical to before on 6 pages;
  a custom theme saved through the owner API reached `/admin/features/public`
  and recoloured the player site (buttons, tabs, icons, wins, ground).
- These are divergences from hash-game-exchange: the hash-sync skill's KEEP
  list has a "rainbet only: owner's own colour themes" section.

## 5. Phase 2 — broken player calls found in rainbet (check the same in the target)

| Problem | Fix |
| --- | --- |
| Request helper `post(path, body)` called as `post(path, { body: {...} })` → strict zod validators reject the extra `body` key with 422. Rainbet: referral `team/join` (sign-up referrals silently lost) and single reward claim. | Send fields at the top level. Grep the frontend for `{ body:` inside request calls. |
| Bets page Sports tab called `GET /sports/bets` (does not exist). | Real route: `GET /api/v1/sports/user/cricket/sports-bets/user?status=all` → `{ data: rows, pagination }`, rows have exchange columns (`id, result_status, status, event_name, match_title, category, league_name, created_at, odds, stake_amount, original_currency`). Map to the UI shape. |
| Change email never sent a code. | `POST /user/email/otp { email: <new address>, purpose: "change-email" }` → code goes to the NEW address → `POST /user/profile/change-email { email, code }`. Needs SMTP: without it the backend answers `EMAIL_SEND_FAILED — SMTP is not configured`; `MAIL_DRY_RUN` is **not** implemented in the backend. |
| Default coin not used by the player site. | Read `defaultCurrency` from `/admin/site-config/public` (owner → Features & plan → Default coin; ~15 s to propagate). Rainbet: (a) wallet deposit/withdraw coin lists put it first (`lib/walletOptions.js` `first`); (b) the session's active coin falls back to it instead of a hard-coded `USDT` (`lib/session.jsx` → `primaryBalance(balances, defaultCurrency)`): owner coin if held or if nothing is held, else the largest holding; a coin the player picked still wins. Look for the same hard-coded fallback in the target frontend. Verified by intercepting the public config in headless Chrome (`defaultCurrency: "BTC"` → BTC first). |
| Settings toggles with no backend column (show bets publicly, show statistics, tip notifications). | Nothing to wire; `/user/preferences` only has `theme, language, emailNotifications, pushNotifications, hideBalance`. |
| Sports frontend calls `/sports/feed/*`, `/sports/catalogue/*` (do not exist). | The sports service serves a different shape under `/sports/user/*` (`odds-events/routes/public.routes.js`). Needs an adapter — parked. |

Useful to list every route the backend really has: `backend/tools/api-surface.js`
(`collect()`), ~900 routes. `backend/docs/API-ROUTES.md` can be stale.

## 5b. Phase 3 findings (admin content → player site)

- **Banners:** admin placements are `home`, `home_mobile`, `slider-1…6`,
  `casino`, `agent-slider-*` (`admin/src/views/content/Banners.tsx`). A
  frontend filtering on another naming (rainbet's looked for `hero-*`) shows
  nothing. Read `GET /admin/banners`, drop `mode: 'agent'` rows, sort
  `slider-N` by N. Row: `{type, mode, active, title, subtitle, cta:{label,href}, url}`.
- **Promotions:** don't pad real promotions with sample cards; samples only
  while the site has none (check the `all` total when a tab is empty).
  A promotion saved with "Published" off is a draft: players never see it,
  and (hash bug) the admin's own list didn't either — admin-service public
  routes are mounted with no auth, so `req.staff` was never set. Fix in
  `promotions/routes/public.routes.js`:
  `router.use(deps.auth.authenticateStaff({ optional: true }))`. Other
  "staff sees drafts" public routes (blogs?) may share the bug.
- **Admin HTML fields:** rainbet added `RichTextField` (contentEditable +
  toolbar + HTML switch, no dependency) for promotion description / terms;
  the value is still an HTML string.
- **Providers:** `GET /casino/games/providers` → `{rows:[{name, displayName,
  logoUrl}]}` (disabled providers already removed); use `displayName` /
  `logoUrl` before any bundled art.
- **Game art:** `/api/v1/casino/games/image/:name` is the platform's own
  artwork (admin uploads) — let it win over bundled art.
- **VIP:** `GET /user/vip` → `{level, name, card, badgeUrl, wager,
  nextLevel, nextName, wagerToNextLevel, progressPct}`; cards bronze…diamond,
  `eternal`. Hard-coded "Unranked / Bronze I" widgets are common — grep.
- **Races:** `GET /user/race` → `[{type: daily|weekly, enabled,
  payout.prizePool}]`; there is no monthly race.
- **Referral:** links are `${PUBLIC_SITE_URL}/referal/<code>` (backend
  `.env` must point `PUBLIC_SITE_URL` at the player site); the player site
  must turn that path into its own referral capture + register modal.
  Players get a code automatically; there is no route to choose one.
- **Display currency:** if the owner's Default coin is fiat (INR), use it as
  the default display currency; the admin shows money in it already.
- **Vite gotcha:** edits made with shell tools (sed) sometimes miss the dev
  server's watcher — the browser keeps an old module ("X is not defined").
  `touch` the file, or check the served source (`curl /src/...`).

## 5c. Phase 4 findings (player features)

- **Audit before building.** The plan said "no screen" for several features,
  but the pixel-matched UI already had Tip (wallet modal) and KYC (Settings →
  Verification) as dead forms. Check the target's screens first; wire what is
  there before adding new ones. Full table in `docs/INTEGRATION-PLAN.md`
  Phase 4 Status.
- **Tip** (`POST /user/tip/send`, body `{ toUsername, currency, amount,
  requestId? }`): needs the owner `tips` entitlement (403 `NOT_ENTITLED`
  otherwise — its message says "your plan", so show a player wording), refuses
  site coins, and may need KYC / wager (`TIP_KYC_REQUIRED`,
  `TIP_WAGER_REQUIRED`). Send in the player's active coin; a fresh UUID
  `requestId` per tip makes retries safe.
- **Crypto withdraw** has no player create route in the user service — only
  list/summary. Not a frontend gap.
- **Owner panel `siteUi.ts`** is hash's list of what the bc.game UI can draw;
  a feature marked `absent` there is locked off with no switch. When the
  target's own UI has the screen, flip it to `toggle` (tips did this) and add
  it to the hash-sync KEEP list.
- **KYC** is one multipart `POST /user/kyc/submit` (details + `idFront` /
  `idBack` / `passport`); Rainbet's Level 1 / Level 2 split is client-side.
- **Coins:** `GET /admin/currencies/public` is already the owner + admin
  coin list (enabled coins, enabled networks, order, image). The player site
  must filter the wallet's coin columns by it — the wallet returns every
  column (NEXO, MKR, …) whatever is switched off.
- **Per-player client prefs:** the header coin pick was one localStorage key
  per browser; switching accounts carried it over (an INR pick made a USDT
  player read 0). Key such prefs by user id.
- **Direct players are root-only in the admin:** wallet adjust, KYC queue and
  player lists scope by `parent_staff_id`; direct signups have none, so only
  `ROOT_STAFF_ID` (superadmin) sees them. A non-root test staff cannot credit
  or approve them — use the superadmin, or the internal wallet route locally.
- **Crypto withdraw / chat** are socket-only in the backend: wire them with the
  Phase 5 socket client rather than adding HTTP routes (keeps backend = hash).
- **Not every backend module matches the screen with the same name:** quests
  (two daily goals) ≠ Rainbet challenges (per-game multiplier prizes);
  `player-bonuses` / `spin-wheel` ≠ Daily Reload. Check the shape first.

## 5d. Phase 5 findings (realtime)

- Read backend `docs/SOCKET-API.md` first: payloads are JSON in a UTF-8 buffer
  (encode/decode both ways), event names are the legacy hashes (copy them
  byte-for-byte), replies are `{ status: true, ... }` or `{ status: false |
  "<message>", error: { code } }` — some refusals put the message in `status`.
- Pushes worth wiring: `CREDIT` (balances, to `user:<id>`), `accountUpdated`,
  `notificationsUnread`, `featuresUpdated`, `currenciesUpdated`,
  `siteConfigUpdated`, `admin_notify`, `ADD_CHAT`, `betSettled` (casino socket,
  in-house socket games only).
- Crypto withdrawals and chat exist only over the socket — no HTTP route.
- Dev proxy needs `ws: true` for `/socket.io` and `/ws`, and must keep the
  Origin (the gateway checks `SOCKET_ALLOWED_ORIGINS`).
- Reconnect sockets when the access token changes (sign-in, refresh,
  sign-out), or the socket stays bound to the previous identity.
- Owner panel `siteUi.ts` marks `chat` absent in hash; flip to a toggle when the
  target's UI has a chat column.

## 5e. Phase 6 findings (new backend modules)

- Every new module is rainbet-only: put it on the hash-sync KEEP list the same
  day (migrations 163–169, models, module folders, the `rainbet:` hooks).
- Stakes: hook responsible-gambling into wallet `debit` (`BET_STAKE`) — every
  provider's stake goes through it. In-house socket games take stakes
  themselves, so they ask `/internal/user/responsible-gambling/check`
  (add to `internalAcl.js`).
- Challenges match on the catalogue `game_uid` (= the catalogue uuid the player
  site uses); settle from the js-games v1/v2 win legs.
- The casino socket must use `transports: ['websocket']` — the gateway 404s
  polling on `/ws/casino`.
- Admin queues are tree-scoped: a non-root staff never sees direct players
  (KYC L1–2 and L3–4 alike). Test with a player parented to the staff.
- Monthly race: the config row starts OFF; set the pool in admin first.
- Google sign-in: backend returns `/login/google?code=` (never tokens); the
  page trades `{code, nonce}`; nonce in sessionStorage per tab. Buttons hidden
  while `/user/auth/google/status` says disabled.
  Owner switch (2026-10-30): owner panel → Entitlements → Sign-in → `google_login` (on unless the
  owner turns it off). `status.enabled` = that switch, so the button shows even with no Google keys;
  `status.configured` = keys set. Start/callback without keys → `/login/google?error=AUTH_GOOGLE_NOT_CONFIGURED`
  ("not available yet"); switch off → `AUTH_GOOGLE_DISABLED`, and exchange answers 403.
- Refresh cookie: client sends `X-Refresh-Cookie: 1` + `credentials:
  'include'`; backend sets `rb_refresh` and drops `refreshToken` from the body.
  Needs same-site API (dev proxy / same domain); add `x-refresh-cookie` to CORS
  `allowedHeaders`.
- Provably fair seeds: not needed while in-house games are off.

- Game page slugs: the backend's slug is `<name>-by-<provider>` (with a uuid suffix on a name
  clash), on every game row as `slug`, resolved by `GET /casino/games/slug/:slug`; `detail/:uuid`
  takes uuids only. A site that builds its own slug (`<provider>-<name>`) gets "Game not found"
  on every game after the 2026-10-30 backend sync. Use `row.slug`.

- JSGames V2 is handed the player's balance in the launch currency (`credit_amount`); the
  operator account upstream takes INR only (USDT → "provider rejected"). A player with ₹0 gets
  "301 - insufficient funds" inside the game, so the game page now stops the launch with a message
  when the chosen balance is empty.
- Favourites: the optimistic row after starring had `game: null`, so the Favourites page drew a
  blank tile with a dead `/games/<uuid>` link until reload. The row now carries the starred tile.
- `/new-releases` and the New Releases rows show ONLY the admin's "New Releases" category (slug
  `new`, `ADMIN_ONLY` in `lib/catalogue.js`): empty page / no row until games are picked. The page
  always asked `sort=newest`, which skipped the admin list entirely.
- Game launch offers INR only (`LAUNCH_CURRENCIES`): USDT/USD are refused upstream (10004).

- Live admin content (no reload): every successful staff write in a player-visible module
  (`CONTENT_SCOPES` in `packages/common/src/contentPush.js`: lobby categories/collections/providers,
  banners, promotions, blog, races, raffle, reload rewards, challenges…) pushes `contentUpdated`
  `{ scopes }` to every player socket (names only, batched 500 ms). The player site
  (`lib/liveContent.js`) re-runs every `useResource` / `useApi` on screen and drops the cached
  category list. Checked: category save → `casino:games`, raffle save → `user:raffle`, a read →
  nothing. Add a module to `CONTENT_SCOPES` when the player site starts showing its data.

- JSGames V2 refuses some games for this operator account with 10004 → our 502 "provider
  rejected": every Hacksaw game (146) and the odd single game elsewhere (probe 2026-10-30: one of
  two at evolution, km, netent). Not fixable here — ask JSGames, or switch Hacksaw off in admin →
  Providers. The game page now says "This game is not available right now".
- Desktop launch card: `GameOverlayShell_shell` is only positioned under the old
  `.magic-container` classes, so on desktop the card (and its error) sat under the frame's art.
  `rainbet-gamepage.css` positions it inside `.RbGame_aspect` from 1007px.

- JSGames' operator account has its bet callback set to a LAN address
  (`http://192.168.1.22:4000/api/v1/casino/js-games/v2/bet-callback`) — set on the provider's
  side, not in our env. On a game error the provider page navigated the whole site there, and no
  in-game bet can settle (the provider cannot reach a LAN IP). Game iframes are now sandboxed
  without `allow-top-navigation` (`GAME_FRAME_SANDBOX`); the callback must be changed at JSGames
  to the deployed backend's public URL.
- Fun Play with JSGames: no demo session exists; the button now says so instead of doing nothing.

- Originals = the Original Games aggregator (hash's design; the in-house socket games stay off).
  Admin → Originals → Games: Sync games, on/off per game, order. The player site reads
  `GET /casino/original-games/games` for the sidebar Originals rail, the home/casino Originals row
  and `/casino/originals`; `/casino/originals/<game_code>` (OriginalGamePage) launches via
  `POST /casino/original-games/launch`. Empty list (no `OG_*` keys yet, nothing synced, or
  Originals switched off) → no rail, no row. Its wallet callbacks also need a public backend URL.
- Sports mode (owner panel → Products, `sportsbook` / `sportsexchange`, one at a time): the player
  site reads `flags.sportsbook` / `flags.sportsexchange` from `GET /admin/site-config/public`.
  (Superseded: main's `SbBook` + `lib/sportsbookLaunch.js` does this now.) Sportsbook on → every `/sportsbook*` path renders
  the book: LuckySports (JSGames uuid `92b24e4c25107367a80e0fe1a97c24e4`) via
  `POST /casino/games/launch`, INR, in a sandboxed iframe; signed out shows Register. Exchange on →
  the existing exchange pages. Both off → 404. The backend also refuses the book launch unless
  `sports` + `sportsbook` are on (`gameEntitlement.js`). Bets inside the book settle through the
  same JSGames callback, so they need the public callback URL too.
- Bet callbacks: a provider can only settle in-game bets if it can reach the backend. Locally,
  expose port 4000 with a tunnel (e.g. `cloudflared tunnel --url http://localhost:4000`) and set
  that URL + `/api/v1/casino/js-games/v2/bet-callback` at JSGames.

## 6. Remaining phases (plan used in rainbet)

3. **Admin content on the player site:** banners, game catalogue
   (collections, categories, providers, priority), promotions, blog, races,
   VIP levels/badges, site config + features + branding, notifications. For
   each: create in admin → confirm the player site shows it → retire the
   sample fallback.
4. **Player features with a backend but no screen:** tip
   (`POST /user/tip/send`), swap, crypto withdraw, withdrawal whitelist, KYC
   upload, change password, gift cards, spin wheel / daily reload, quests →
   challenges, loss bonus, wager progress, mark-all-read, global search
   (`/casino/games/search`).
5. **Realtime:** one socket.io client (gateway `/ws/<svc>/socket.io`) for
   notifications, live bets (replace polling), chat, owner pushes.
6. **Backend modules that do not exist:** raffle, kick drops, challenges,
   chat over HTTP, server-side gambling limits / self-exclusion, provably-fair
   seeds over HTTP, OAuth, refresh token in an httpOnly cookie. Each new
   backend module goes on the hash-sync KEEP list.
7. **Credentials:** crypto deposits (`CCPAYMENT_*`), card/on-ramp PSP, game
   provider launch keys, SMTP. Sandbox first; check every money flow against
   the admin ledger.
8. **Sportsbook** adapter.

## 7. Working method that worked

- Before each phase, map the code (frontend call sites ↔ backend routes)
  rather than trusting docs; verify each claimed bug by reading the validator
  or calling the route.
- Test every fix against the running stack with `curl` through the player
  site's own proxy (`http://localhost:5173/api/v1/...`) — registering a
  throwaway player when needed — then remove test players.
- After each phase give the user a "how to test" list (URLs, accounts, clicks,
  expected result) and wait for their go-ahead.
- One commit per phase on a working branch, then fast-forward `main`.

## 8. Fake player-site data removed (2026-10-30)

Check the same in the target. A casino must not show invented wins, players or prize pools as live.

- **Live Wins, live bets board, bet popup:** captured rows and derived sample ids, dates, providers and
  profiles deleted (`LiveWins.jsx`, `ActivityBoard.jsx`, `publicOverlayEvents.js`). No wins: the belt
  is not drawn. No bets: the board's empty state.
- **Race pages:** sample board, prize ladders and fallback pools deleted. Race off: the player is sent home (see below);
  the page keeps no sample board.
- **Rewards signed out:** the goal is the first rank of `GET /user/vip/levels`, not a fixed $4,000.
- **Promotions, Blog:** `lib/promotionSamples.js`, `lib/blogSamples.js` and
  `public/rainbet/promotions/` deleted; empty messages instead.
- **Partners:** `data/rainbetPartners.js` deleted. The strip reads admin banners `partner-1`…`partner-6`
  (title = name, image = photo) and is hidden with none. No backend change: banner types are free text.
  Admin `Banners.tsx` lists the six placements (hash-sync KEEP).

**Sidebar (2026-10-30):** race pills and Promotions race rows show the admin's `prizePool` in full ($10,000, not $10K), the race page headline too. A race switched off has no pill or row, and nothing is listed until `GET /user/race` answers. With raffles off, the raffle block (and its padding) is not drawn. The page's Daily / Weekly / Monthly tabs still list every race.

**Race switched off (2026-10-30):** the race page sends the player to `/` (history replaced) once `GET /user/race` says that race is off, re-read on the `contentUpdated` push and every 30s, as is the sidebar (which ignored the push before). A failed read does not redirect. The page tabs list only running races.

## 9. Whitelabel phase 1: copy side (2026-10-30)

Ported from hash-game-exchange, whitelabel lines only. Off unless `WHITELABEL_MODE=true` (backend) and `NEXT_PUBLIC_WHITELABEL_MODE=true` / `VITE_WHITELABEL_MODE=true` (builds).

- **Backend:** `modules/whitelabel-link`, `gateway/src/middleware/maintenance.js`, read-only `ro` token, no self-funding, `POST /admin/exchange/owner/move-to-agent-system`, migration 171.
- **Not taken from hash:** forced password change on new staff, issued random transaction codes, 8-character staff passwords, the looser creation ladder, hiding promotions from levels 2-3.
- **Chosen code:** `PATCH /admin/staff/password` takes `transactionPassword` on a forced change only.
- **Player site (rainbet's own):** `lib/palette.js` `fromWhitelabel` maps the 13 tokens onto rainbet's palette; `lib/branding.js` applies it and shows a maintenance screen, polling `whitelabel-link/status` every 15s.
- **Check a copy locally:** run admin-service with `DB_NAME=<a throwaway DB>`, `WHITELABEL_MODE=true`, `WHITELABEL_LINK_KEY=<key>`, then call the link directly on the service port.

## 10. Whitelabel phase 2: parent panel (2026-10-30)

Ported whole from hash-game-exchange: `modules/whitelabels`, `admin/src/views/whitelabels`, `admin/src/app/(pages)/whitelabels`, sidebar group Whitelabel (Super Admin only, hidden on a copy). Hash migrations 164 to 166 are 172 to 174 here.

Until the setup worker exists a created row stays `queued`: nothing is built.

## 11. Whitelabel phase 3: setup worker (2026-10-30)

`scripts/whitelabel/{lib,steps,worker}.mjs` from hash, plus `scripts/make-env.mjs`. Changed for rainbet:

- The player site is a static Vite build: Apache serves `frontend/dist` with `FallbackResource /index.html`. No pm2 app and no port for it (the block's frontend port stays reserved, unused).
- Env keys: `VITE_API_BASE` (with `/api/v1`), `VITE_API_ENC_KEY`, `VITE_WHITELABEL_MODE`. Parent values come from `frontend/.env` and `.env.local`.
- Before the build the worker swaps `Rainbet`, `Rain Group Ltd` and `rainbet.com` in the player site's source and strips the parent's icons from `index.html` (`rebrandText`, `stripParentArt`).
- `lib/branding.js` on a copy build never falls back to Rainbet art: no logo shows the name as text. `HomeHero` with no poster draws the logo.

**On the server (Linux, as root):**

1. Needs Node 20.12+, Postgres, Redis, pm2, Apache with `proxy proxy_http proxy_wstunnel rewrite headers`, and certbot's Apache plugin.
2. The parent must be a git checkout under `/var/www/main/`; copies go in `/var/www/main/<slug>`. A copy gets only committed code (`git archive HEAD`).
3. Set `WHITELABEL_SERVER_IP` in `backend/.env` if `hostname -I` is ambiguous.
4. `pm2 start scripts/whitelabel/worker.mjs --name rainbet-whitelabel-worker && pm2 save`
5. Point the three domains' A records at the server **before** creating a whitelabel; certbot needs them.

**Home sports rail in Exchange mode (2026-10-30):** each card opens `/sportsbook?sport=<id>` (`exchangeTabOf` in `pages/Exchange/model.js`); `/sportsbook/<slug>` redirects there. A sport the feed does not list shows "No <sport> matches right now." instead of the cricket board.

## 12. Languages and removed routes (2026-10-30)

- Removed routes `/canada` and `/kick-drops` (now 404). Page files are kept, unrouted.
- Owner flags `lang_ar|en|es|fr|ja|pt|ru|tr|zh`; `GET /admin/site-config/public` returns `languages`.
- `frontend/src/lib/i18n.js`: swaps page text by exact match against `src/i18n/<code>.json`, loaded on demand, with a MutationObserver only while not in English. Screens stay written in English. Add `className="notranslate"` to keep a node out.
- Sidebar picker and chat room list show allowed languages only; no picker with fewer than two. A language switched off moves the player to English or the first allowed, and the saved choice is kept.
- String list: `frontend/scripts/i18n-strings.mjs`.

- `partnerships@shuffle.com` removed from the affiliate pages; footer emails changed to `@example.com` dummies (2026-10-30).
- Contact and legal page emails also changed to `@example.com` dummies, same local part (2026-10-30).

- Visible "Shuffle" text changed to Rainbet across the player site, shuffle.com links now point inside the site, Shuffle logos in that content use the Rainbet mark (2026-10-30). Code identifiers and slugs (`ShuffleWise`, `/blog/shuffle-kyc`) keep their names. The SHFL token content is unchanged.

- SHFL token content removed (2026-10-30): the two articles, mentions in SEO text and the payment guide, the coin label and network, and its icons.

- Sportsbook iframe width now matches the exchange: `.RbSb_book` max-width 1200px, centred (2026-10-30).

## 13. VIP levels: switch off and add (2026-10-30)

Admin, VIP Club, VIP ladder: an On site switch per level and an Add level button. Migration `175`. `rebrand` in `vipLadders.js` drops switched-off levels and adds new ones. A new level goes on top only, because level numbers must climb with thresholds and reward keys use them. It pays the rewards of the tier chosen. The player VIP page hides a tier with no level left on. The ladder cache in other services lasts up to 10 seconds.

- VIP perks by rank (2026-10-30): migration `176`, `vip-branding` perk routes, public `GET /admin/vip-branding/perks`, `vip.service.js` `#perkPays`, `admin/src/views/promotions/VipPerks.tsx`, `VipPublic.jsx` reads them. The table now has one Eternal column in place of Infernal and Infernal Diamond.

## 14. Casino money and exchange fixes (2026-10-31)

- Casino: `gis.service.js` (refund and rollback pay once, refund capped at the stake, player and currency checked), `seamless.service.js` (rollback and cancel pay once, legacy signature needs `SEAMLESS_ALLOWED_IPS`), a win naming a round with no bet is refused on Slotegrator, Originals, Seamless and JSGames v1, `gameEntitlement.js` honours the site admin's casino switch. These are not in hash-game-exchange yet.
- Report keys stay `rf:` and `rb:` because the reports read them. The guard is a row lock on the bet plus a check for the other key.
- Exchange price rule: `betBufferRules.mjs` `deriveBufferFlags` sets `priceGuarded` for gtype `match` and `match1`, and `autoBetCheck` enforces it (test: `bets/__tests__/betBufferPrice.test.js`). Not in hash-game-exchange yet. The slip does not follow the live price. `betFlow.js` sends `live_tracked` for `match1` too, so those markets use the live-market delay.
- Stake chip defaults: `services/exchange/stakes.js` and `StakeButtonService.mjs`.
- Open items and test data: `docs/PENDING.md` sections 10 and 11.

## Fixes from the full site test (2026-10-31)

Listed in docs/PENDING.md section 13. These are rainbet-side fixes that hash-game-exchange and main-server do not have yet. New migration: `177-redeem-amount-decimal` (run `npm run db:migrate` in `backend/`). Restart the backend after pulling. Where services use their own database users, rerun `npm run db:grants` so casino and sports can read `auth_sessions`, or their player requests fail.

## Claimable rank-up rewards (2026-10-31)

`VipService.onWager` credits level-ups only and sends a "ready to claim" notification for a rank-up. `rankUps` and `claimRankUps` pay what is waiting, with the same wallet idempotency key as before, so nothing pays twice. The Rewards page button shows the USD total and is disabled when nothing waits. Details and open items: docs/PENDING.md section 17.

## Pending sweep (2026-10-31)

Frontend: the signed-in Loss Limit page opens the real limits tool; Provably Fair's Manage Seed dialog (made-up seeds, no API) is gone; the raffle amount comes from the raffle API only. Backend, not in hash-game-exchange or main-server: `wager.service.js` getProgress reads "1,00.00" style wager values; the five rainbet-only routes without a body validator (`kyc-levels` submit, three VIP Club deletes, Originals sync) take `noBody()`. Tests: 87 failing before, 3 after, all three from hash. Details: docs/PENDING.md section 18.

## Untested features run (2026-11-01)

Reload claims, owner panel save, raffle and race pages, every admin page and a set of admin saves were run locally. Fixed: the sports service no longer stops when a sportsbook handler answers after the request timeout (`services/sports/src/lib/mssports.js` `lazy()`, not in hash-game-exchange or main-server), and the raffle's free-ticket button is disabled after an early draw. Local sports pages need Redis running. Details: docs/PENDING.md section 19.

## Local Redis and sports pages (2026-11-01)

Local Redis runs from `%LOCALAPPDATA%\rainbet-redis\start-redis.ps1` (user process, 127.0.0.1:6379). Sports lobby, In-Play and match pages checked with it up. The player site no longer asks for the running raffle while the owner has raffles off (`raffleData.js`). Details: docs/PENDING.md section 20.

## Wiring not covered in the sections above (2026-10-28 to 2026-11-01)

Checked against every commit on `dev-gurprince`. Each line names the commit; the hash-sync skill's KEEP list names the exact files for the backend ones.

- **Tips** (`3904c30`, `4ca8e12`): Wallet Tip tab sends real tips with a request id (no double send on retry). Optional `fromCurrency` on `POST /user/tip/send`: a coin the player holds too little of is paid from the wallet coin at the platform rate, no fee; the receiver gets the picked coin. Settings → Preferences has an Accept Tips switch (tip settings route); off = tips refused. Tips need a Verified KYC (`TIP_KYC_REQUIRED`). Owner panel and admin treat tips as a real switch.
- **Coins and header** (`c3fe699`, `489b49d`, `3904c30`, `4ca8e12`): header, wallet and Wallet Settings list only coins and networks the owner and admin have on, in the site's order, with uploaded images. The header unit follows the owner's default coin; the picked coin is remembered per player. The header shows all wallets added up in the display unit.
- **KYC** (`3904c30`, `9bb82e6`, `8898e96`): Level 1 details and the Level 2 ID go up as one submission. Levels 3-4 (proof of address, source of income) with an admin review queue, shown in the KYC table under the status tabs. Site switch `siteconfig.kyclevels` (migration 170), which the owner can also turn off.
- **Deposits** (`9bb82e6`): the Deposit tab shows the house crypto address from admin Bank details, with a QR code and a claim form (amount, tx hash, optional screenshot), falling back to the provider address. Bank deposits send the screenshot the backend requires. Uploaded KYC documents and deposit proofs are stored under `backend/services/user/storage/`, which git ignores (`c10e91a`).
- **Sockets** (`880a1ce`): one shared socket client for the user and casino services (`frontend/src/lib/socket.js`), reconnecting when the access token changes. Live: balances, notifications (unread dot), owner theme/feature/coin changes, site config, and the bets board on `betSettled`. Chat runs over the socket with two rooms and VIP badges. Crypto withdrawals are requested over the socket with the account password.
- **Live admin content** (`7d371c9`): admin writes push `contentUpdated {scopes}` and the player site re-reads without a refresh (`frontend/src/lib/liveContent.js`, `useResource`).
- **Originals and game launch** (`7d371c9`): admin sync, on/off and order for Originals; the lobby row, sidebar and game page follow. Launch goes through the unified casino launch: demo only on Slotegrator, INR only, an empty-balance guard, sandboxed frames.
- **Password reset and 2FA** (`7d371c9`): the reset email renders and links to `/reset-password?token=`. There is a 2FA code at login and a 2FA reset by email. `MAIL_DRY_RUN` logs unsent mail in development.
- **VIP rank on the site** (`382dac6`): the home progress card and the profile rank read the real level, progress and next rank (`frontend/src/lib/vipRank.js`), with the admin's uploaded badge. `wagerUpdated` pushes progress live (`2334d1c`).
- **Player features** (`8898e96`): the monthly race, promotion article blocks (tournament panel, qualifying games, events, leaderboard), privacy switches (show bets publicly, show statistics, tip notifications), per-game big and lucky wins, and the refresh token in an httpOnly cookie for the player site.
- **Staff access and passwords** (`de4ebb3`): staff below the Super Admin see the agent system only (`DIRECT_USERS_ONLY`). The first login forces a password change for staff and agent users (`users.must_change_password`, migration 178). Staff get a random transaction code there. After that only an upline changes a password. Executives have one-click instant roles. Redeem codes take decimals (migration 177).
- **Lobby from the admin** (`de4ebb3`): home rows and the sidebar Casino list use Admin → Casino → Lobby curation (Categories tab) or the real catalogue, never captured tiles.

## Server load and sockets (2026-11-01)

Fewer repeated reads without slower or wrong data. Commit `39f251f`, migration renumbered in `a7148b4`.

- Backend sports, not in hash-game-exchange or main-server: `services/sports/src/modules/odds-events/sockets/boardPush.mjs` (new). Socket events `subscribeSport` / `unsubscribeSport`; the server sends `sportBoard` (the same body as `GET /sports/user/cricket/all-data`) every 2 s per watched sport, at most 8 boards. `cricketController.mjs` `sportBoardReply`. `lib/config/redisClient.mjs`: Redis calls time out after 2 s instead of hanging; the pub/sub copy in `bets/sockets.js` keeps no timeout.
- Backend casino, not in hash-game-exchange or main-server: `bet-history/betHistory.service.js` shares third-party rounds for 3 s and the public leaderboard for 10 s; in-house wins and "my position" are always fresh.
- Backend user, not in hash-game-exchange or main-server: `lib/rewardMoney.js` keeps an exchange rate for 2 s inside one payout.
- Migration `188-bet-time-indexes`: indexes on `bets.created`, `bets (profit, won)`, `js_game_transactions.timestamp`, `game_transactions.created_at`.
- Player site: `services/exchange/boardSocket.js` (new) and `hooks/exchange/feedHooks.js` `useSportsList`: the sports lobby uses the pushed board and falls back to HTTP when no push came for 6 s. `LiveWins.jsx` and `ActivityBoard.jsx` read every 5 s plus on `betSettled` (throttled), and not in a hidden tab. `Sidebar.jsx` reads the race only while the socket is down. `usePublicSiteConfig.js` shares one request. `liveContent.js` spreads re-reads over 0.8 s.
- Admin: `components/shared/RealtimeRefresh.tsx` backstop every 15 s (was 2 s).
- Tested: headless Chrome. Sports lobby: 0 HTTP polls and 8 `sportBoard` pushes in 15 s. Casino: 6 live-feed reads in 15 s (was about 18). Unit test `odds-events/__tests__/boardPush.test.js`.

## Game stats by period and push prompt after first deposit (2026-11-01)

- Backend casino, not in hash-game-exchange or main-server: `bet-history/betHistory.validators.js` `myHistory` takes `game`; the service filters by it.
- Backend user, not in hash-game-exchange or main-server: `GET /api/v1/user/bonus/first-deposit` adds `hasDeposited` for a signed-in caller (`firstDepositBonus.service.js` `hasDeposited`).
- Player site: `GameStatsPanel.jsx` range select (All, 24 hours, 7 days, 30 days). `PushPrompt.jsx` handles the admin's `after_first_deposit` trigger.
- Commit: `c1c092c`.

## Fixes from the full admin, owner and player QA (2026-11-01)

A workflow ran the player site, the admin (players and money, promotions and content, casino/sports/site config/staff) and the owner panel. Commit `52b6611`.

- Backend admin, not in hash-game-exchange or main-server: `blogs/routes/public.routes.js` and `banners/routes/public.routes.js` read an optional staff token, so the admin sees blog drafts and hidden banners again (the public still does not). `statements/statements.service.js` and `reports/reports.service.js` count `raffle_prize`, `reload_bonus`, `race_reward_claim`, `rakeback_claim`.
- Admin: `views/reports/Statements.tsx` shows the all-time gap next to "unexplained". `views/casino/Categories.tsx` keeps the moved category selected. `RouteGate.tsx` refusal text for Super-Admin-only screens. Password hint 8 characters (`MyAccount.tsx`, `ExecutivesList.tsx`). `CurrentBets.tsx` pager never shows `1 / 0`.
- Owner panel: `next.config.ts` `allowedDevOrigins: ['127.0.0.1']` (dev only).
- Player site: Originals read `jsGames.originals()` (`OriginalGamePage.jsx`, `catalogue.js`, `Sidebar.jsx`); Settings switches keep the server's values (`SettingsPage.jsx`); `lib/branding.js` re-reads on `featuresUpdated` and on `contentUpdated` scope `admin:branding`.
- Tested: blog draft created, seen by staff only, deleted; hidden banner listed for staff only; tipqa_a's balance sheet now differs only by the crypto withdrawal (see PENDING 21).
