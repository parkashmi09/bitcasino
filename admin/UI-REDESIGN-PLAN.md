# Bitcasino Admin — UI Redesign Plan (ccpayment look, MUI)

Status: **DRAFT — waiting for "go"**. No code is changed until approval.

## Goal

- Only the **look** of `bitcasino/admin` changes. It should match the ccpayment console exactly: colors, fonts, spacing, radius, shadows, hover/transition smoothness.
- **Zero functional change**: same API calls, same routes, same permissions, same validation, same props.
- Built with **Material UI (MUI v7 + emotion)**.

## Rule: change the layer, not the pages

Hash-sync keeps changing `views/` (190 commits in 30 days), while `ui/` has had only 6.

- We change only `components/ui`, `components/layout`, `components/shared` (visual part), `theme/` and `globals.css`.
- **Every component keeps the same file, export names and props.** Inside, it renders MUI.
- That way 116 view files get the new look without being touched.

| Allowed to edit | Never edit |
|---|---|
| `src/components/ui/*` | `src/views/**` (except login page markup) |
| `src/components/layout/*` | `src/hooks/**`, `src/lib/**`, `src/app/api/**` |
| `src/components/shared/*` (styling only) | react-query keys, fetch calls, validation, `Can`/`RouteGate` logic |
| `src/theme/*` (new) | `configs/site.ts`, `.env*`, routes |
| `src/app/globals.css`, root layout providers | component props / export names |

## Phase 0 — Exact tokens from live ccpayment

The saved zips lost MUI's runtime CSS, so exact colors cannot be read from them. You log in to `console.ccpayment.com` in QA Chrome (password typed by you). Then on each of the 8 pages I read computed styles and record them in `src/theme/tokens.ts`:

- palette: primary, secondary, success/warning/error/info, text primary/secondary/disabled, divider, background default/paper, sidebar bg, sidebar active item bg/text, table header bg, row hover
- typography: font families (Poppins, Circular Std), sizes and weights for h1–h6, body1/2, caption, button, table header
- shape: border radius for card, button, input, chip, dialog
- shadows: card, dropdown/popover, dialog, AppBar
- spacing: page padding, card padding, table cell padding, sidebar width (open/collapsed), AppBar height
- motion: transition duration and easing for hover, drawer open/close, tab indicator, dialog enter/exit, collapse

## Phase 1 — Baseline (before any change)

`scripts/baseline.mjs` (in the skill) visits each of the 87 admin routes on CDP and saves:

1. a screenshot (desktop 1440 and mobile 390)
2. the list of API requests (method + path + query, no bodies/tokens)
3. console errors
4. a DOM inventory: buttons/inputs/links count and their labels

## Phase 2 — Foundation (one agent, me)

- `npm i @mui/material @emotion/react @emotion/styled @mui/x-date-pickers` (+ `@mui/material-nextjs` for App Router SSR cache)
- `src/theme/tokens.ts` + `src/theme/theme.ts` (`createTheme` with component overrides)
- `ThemeProvider` + `AppRouterCacheProvider` + `StyledEngineProvider` with `enableCssLayer`, so Tailwind utilities in views still win where they set layout
- `globals.css`: remap the shadcn variables (`--primary`, `--card`, `--border`, `--muted`, …) to the same tokens, so Tailwind classes inside views also show ccpayment colors
- dark mode: decided by your answer (see questions)

## Phase 3 — Component by component

Columns: **Used** = number of files importing it. **MUI** = what it becomes inside. **ccpayment ref** = where to copy the look from. **Test** = what must pass before it is marked done (on top of the common checks below).

### 3.1 `components/ui` (44)

| # | Component (exports) | Used | MUI inside | ccpayment ref | Test |
|---|---|---|---|---|---|
| 1 | `button` (Button, buttonVariants) | 103 | `Button` / `LoadingButton` / `IconButton` per `variant`+`size` | Export, Filters, Clear Filters, Sign in | every variant (default, outline, secondary, ghost, destructive, link) × size (sm, default, lg, icon) renders; `onClick`, `disabled`, `type="submit"` submits form; `asChild`/`render` link still navigates; `buttonVariants()` class string still usable on `<Link>` |
| 2 | `input` (Input) | 63 | `InputBase`/`OutlinedInput` | search + filter inputs | typing updates value; `name`, `type=password/number`, `min/max`, `disabled`, `readOnly`, `aria-invalid` red border; ref forwarded (forms using `ref`) |
| 3 | `card` (Card, Header, Title, Description, Action, Content, Footer) | 61 | `Card`, `CardHeader`, `CardContent`, `CardActions` | dashboard balance cards, stat cards | all 7 parts render in same order; `className` passthrough; `CardAction` stays top-right |
| 4 | `badge` (Badge, badgeVariants) | 43 | `Chip size="small"` | status pills (Success / Processing / Failed) | each variant color; text unchanged; no click handler added |
| 5 | `select` (Select … SelectValue, 10 parts) | 34 | `Select` + `MenuItem` (wrapped so the base-ui API stays) | "X(All)" filter dropdowns | open/close by click + keyboard; `value`/`onValueChange` fires with same value type; placeholder; `disabled`; inside Dialog it is not clipped |
| 6 | `tabs` (Tabs, TabsList, TabsTrigger, TabsContent) | 27 | `Tabs` + `Tab` + panel | Deposit / Withdrawal tabs | `value`/`onValueChange`; URL-synced tabs (`TabbedPage`) still change route; indicator animates |
| 7 | `dialog` (10 parts) | 28 | `Dialog`, `DialogTitle`, `DialogContent`, `DialogActions` | ccpayment modal style | open via trigger and via `open` prop; Esc and backdrop close; `onOpenChange`; focus trap; form submit inside works; scroll for long content |
| 8 | `switch` (Switch) | 26 | `Switch` | settings toggles | `checked`/`onCheckedChange`; `disabled`; keyboard space toggles |
| 9 | `table` (8 parts) | 23 | `Table`, `TableHead`, `TableBody`, `TableRow`, `TableCell` | transaction / ledger tables | header style, row hover, zebra none; `colSpan`, sticky header; horizontal scroll on mobile |
| 10 | `skeleton` (Skeleton) | 22 | `Skeleton variant="rounded"` | — | size from `className` kept; wave animation |
| 11 | `alert` (Alert, Title, Description, Action) | 11 | `Alert` + `AlertTitle` | info banners | variants (default, destructive) map to severity; action slot clickable |
| 12 | `checkbox` (Checkbox) | 11 | `Checkbox` | table row select | `checked`/`indeterminate`/`onCheckedChange`; label click toggles |
| 13 | `date-picker` (DatePicker, DateTimePicker, DateRangePicker, parseDate, toDateString) | 11 | `@mui/x-date-pickers` | "Select Date" range | same string format out (`toDateString` untouched); range presets; clear; timezone unchanged |
| 14 | `label` (Label) | 11 | `FormLabel`/`InputLabel` | form labels | `htmlFor` focuses input; required asterisk |
| 15 | `field` (10 parts) | 4 | `FormControl`, `FormHelperText` | form rows | `FieldError` shows red helper text; layout vertical/horizontal |
| 16 | `input-group` (6 parts) | 3 | `OutlinedInput` + `InputAdornment` | search with icon | addon left/right; button inside clickable |
| 17 | `separator` | 3 | `Divider` | — | horizontal + vertical |
| 18 | `sidebar` (23 parts) | 3 | `Drawer` + `List` + `ListItemButton` + `Collapse` | left menu | see layout/Sidebar test |
| 19 | `textarea` | 3 | `OutlinedInput multiline` | — | value, rows, maxLength |
| 20 | `dropdown-menu` (15 parts) | 2 | `Menu` + `MenuItem` | profile menu | items fire `onSelect`; checkbox/radio items; submenu; keyboard nav |
| 21 | `radio-group` | 2 | `RadioGroup` + `Radio` | — | `value`/`onValueChange` |
| 22 | `sonner` (Toaster) | 2 | keep sonner, restyle to MUI `Alert` look | toast | success/error toast appears, auto-closes; `notifyError` unchanged |
| 23 | `tooltip` (4 parts) | 2 | `Tooltip` | icon hints | hover + focus shows; no layout shift |
| 24 | `avatar` (6 parts) | 1 | `Avatar`, `AvatarGroup` | top-right user avatar | image + fallback initials |
| 25 | `breadcrumb` (7 parts) | 1 | `Breadcrumbs` | page header | links navigate |
| 26 | `calendar` | 1 | `DateCalendar` | — | selected day callback same `Date` |
| 27 | `circular-progress` | 1 | `CircularProgress` | — | value prop |
| 28 | `collapsible` (3 parts) | 1 | `Collapse` | sidebar groups | open/close state, animation |
| 29 | `popover` (6 parts) | 1 | `Popover` | filter popup | anchor position, outside click closes |
| 30 | `progress` (5 parts) | 1 | `LinearProgress` | — | value |
| 31 | `sheet` (8 parts) | 1 | `Drawer` (temporary) | mobile menu | side, close button, Esc |
| 32 | `toggle-group` | 1 | `ToggleButtonGroup` | "X(All)" segmented buttons | single/multiple value |
| 33 | `toggle` | 1 | `ToggleButton` | — | `pressed`/`onPressedChange` |
| 34 | `background-ripple` | 0 | leave as is | — | — (unused) |
| 35 | `button-group` | 0 | `ButtonGroup` | — | unused, theme only |
| 36 | `chart` | 0 | leave (recharts), colors from tokens | — | unused |
| 37 | `combobox` | 0 | `Autocomplete` | — | unused, theme only |
| 38 | `command` | 0 | leave | — | unused |
| 39 | `input-otp` | 0 | restyle slots | — | unused |
| 40 | `pagination` | 0 | `Pagination` | table footer | unused directly (DataTable has its own) |
| 41 | `rating` | 0 | `Rating` | — | unused |
| 42 | `resizable` | 0 | leave | — | unused |
| 43 | `scroll-area` | 0 | thin scrollbar CSS | — | unused |
| 44 | `timeline` | 0 | `@mui/lab Timeline` or leave | — | unused |

Unused components (0 imports) only get theme colors. They are not rewritten.

### 3.2 `components/layout` (7)

| Component | MUI inside | ccpayment ref | Test |
|---|---|---|---|
| `Sidebar` | permanent `Drawer` (desktop), temporary (mobile), `List` + `Collapse` groups, active item pill | left menu (Dashboard, Transaction, API Order ▸, Balance ▸ …) | every menu item still links to the same route; `Can` permission hiding unchanged (log in as staff with fewer perms: same items hidden as before); active item highlights on route change; group open state; collapse to icons; mobile open/close |
| `Header` | `AppBar position="sticky"` + `Toolbar` | top bar with avatar, language, notifications | menu-toggle button works; OwnerBalance shows same number; profile menu opens |
| `Footer` | `Box` + `Typography caption` | — | same text/links |
| `ModeToggle` | `IconButton` | — | theme switch persists (if dark kept) |
| `OwnerBalance` | `Chip`/`Typography` | balance pill | same value, same refresh |
| `ScrollToTop` | `Fab size="small"` + `Zoom` | — | appears after scroll, scrolls to top |
| `BlankLayout` | `Box` full-height centered | login page bg | login/blank routes render |

### 3.3 `components/shared` (visual ones)

| Component | Used | Change | ccpayment ref | Test |
|---|---|---|---|---|
| `PageHeader` | 83 | `Typography h5` + actions row + breadcrumb | page title row | title, description, action buttons same |
| `DataTable` | 49 | MUI `Table` + `TablePagination` + empty/loading states | transaction table + pagination "Rows per page" | same columns, sort click sends same query, page change sends same `page`/`limit`, row click handlers, empty state, loading skeleton |
| `FormField` | 46 | label + input + `FormHelperText` | form rows | errors from `FormErrorsProvider` show under the right field |
| `ErrorState` | 47 | `Alert` + retry `Button` | — | retry calls the same refetch |
| `DateTime` | 41 | typography only | "Payment Time" column | same formatted string |
| `FormDialog` | 35 | MUI `Dialog` with title/actions | modal | submit, cancel, loading state, server errors shown |
| `StatusBadge` | 35 | `Chip` with status color map | Success/Processing/Failed pills | every status string maps to the same meaning (green/amber/red/grey) |
| `Can` | 32 | **no change** (logic) | — | — |
| `Money` | 32 | typography (tabular nums) | Amount / Value columns | same number + currency text |
| `ConfirmDialog` | 22 | MUI `Dialog` small | — | confirm fires action once; cancel does nothing |
| `StatCard` | 20 | `Card` with icon, label, big number | "Today's Deposit" cards | same value, trend, link |
| `ChannelTabs` | 16 | MUI `Tabs` | tabs row | same channel switch |
| `ReportMoney` | 11 | typography | — | same value |
| `DefaultCurrency` / `RewardCurrency` | 8 / 7 | `Select` look | currency select | same value saved |
| `JsonView` | 8 | `Paper` mono | — | same content |
| `BrandMark` / `Logo` | 4 / 2 | Bitcasino logo asset | top-left logo | links home |
| `TxnCodeInput` | 4 | restyled OTP slots | — | code submit same |
| `TabbedPage` | 2 | MUI `Tabs` | — | route-synced tabs |
| `ProfileDropdown` | 1 | `Menu` | avatar menu | logout calls `/api/auth/logout` |
| `RouteGate`, `RealtimeRefresh`, `PolicySelect` | — | **no change** (logic) | — | — |
| `charts/*` (ChartCard, ChartFrame, Charts, FilterBar, KpiCard) | 1–3 | `Card` frame + token colors for series | dashboard charts | same data, same filter query |

### 3.4 Login page

`app/(blank)/login`: ccpayment Sign in layout (left brand panel + right form card). Test: same fields, same submit to `/api/auth/session`, error message shown, redirect after login, TxnCode/OTP step if enabled.

## Common checks (run for every component and every page)

1. `npx tsc --noEmit`, `npm run lint`, `npm run build`: all pass.
2. `scripts/guard.mjs`: fails if any file outside the allowed list is changed, or if any `export` name or props type in `ui/` changed.
3. CDP after-run on the same 87 routes:
   - **API requests identical** to baseline (same method/path/query set). Any difference = fail.
   - **No new console errors.**
   - **DOM inventory**: same buttons/inputs/links and labels.
   - Screenshot side-by-side with the ccpayment reference page.
4. Interaction smoke per page group: open a dialog, submit a form with an invalid value (error shows), change a filter (same query sent), paginate, switch tab.
5. Mobile 390px: no horizontal scroll, drawer works.

## Agents (after "go")

| Agent | Work | Browser |
|---|---|---|
| main (me) | Phase 0–2, theme, guard script, final review | yes |
| A | ui: button, input, card, badge, label, field, textarea, input-group, separator, skeleton, alert, checkbox, switch, radio, toggle(s) | no |
| B | ui: select, tabs, dialog, dropdown-menu, popover, tooltip, sheet, date-picker, calendar, sonner | no |
| C | layout (Sidebar, Header, …) + shared (PageHeader, DataTable, StatCard, StatusBadge, FormDialog, …) + login | no |
| QA-1, QA-2 | CDP checks per page group after each batch (max 2 browser agents) | yes |

## Skill to create (after "go"): `bitcasino-admin-ui`

- `SKILL.md`: rules above, tokens, component map, check procedure
- `scripts/baseline.mjs`, `scripts/compare.mjs` (CDP before/after), `scripts/guard.mjs`
- `hash-sync` note: `admin/src/components/{ui,layout,shared}`, `theme/`, `globals.css` are bitcasino-owned. A hash change there is merged by hand, keeping MUI.

## Need from you

1. ccpayment live login in QA Chrome (or SingleFile re-save of the 8 pages).
2. Bitcasino admin login on the test API.
3. Light only, or dark too?
4. Bitcasino logo file.
5. Use the 9th zip (`merchatsetting`) too?
