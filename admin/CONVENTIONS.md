# site-admin — how a screen is built

Next.js 16 (App Router, Turbopack) + React 19 + shadcn/base-ui + Tailwind 4 + @tanstack/react-query + nuqs.
Backend: the merged iBitPlay platform in `../backend` (gateway `http://127.0.0.1:4000`). Route reference:
`../backend/docs/API-ROUTES.md` (regenerated, current) and `../docs/ADMIN-FEATURE-INVENTORY.md` (the screen spec).

## Layout

```
src/app/(pages)/<route>/page.tsx      thin: metadata + <Suspense><View/></Suspense>   (server component)
src/views/<area>/<View>.tsx           'use client' — the screen
src/views/<area>/types.ts             row types for that area
src/components/shared/*               DataTable, FormDialog, ConfirmDialog, FormField (TextField/SelectField/SwitchField/TextAreaField),
                                      PageHeader, StatCard, StatusBadge, Money, DateTime, JsonView, ErrorState, Can
src/hooks/use-api.ts                  useApi, usePagedApi, useListState, useApiMutation, useInvalidate
src/lib/api/client.ts                 api.get/post/put/patch/delete/upload/paged/blob/url, ApiError, errorMessage
src/configs/navConfig.tsx             the sidebar (entries for every planned screen already exist — match the hrefs)
```

Dynamic route pages take `params: Promise<{ id: string }>` and `await` it (Next 16).

## Talking to the backend

- Paths are GATEWAY paths without `/api/v1/`: `api.get('admin/staff')`, `usePagedApi('admin/user/deposits/fiat', query)`.
  The browser hits `/api/gw/api/v1/...`; the proxy adds the staff token from the httpOnly cookie.
- Lists: the platform pages by `limit`/`offset`. `usePagedApi` + `useListState` handle it — pass `page`, never `offset`.
- **Every validator is `.strict()`**: an unknown query/body key is a 422. Before wiring a route, read its validator:
  `../backend/services/<service>/src/modules/<module>/<module>.validators.js` and its `routes/admin.routes.js`.
  Only send the keys it accepts. `useListState` puts `search/sort/order` in the URL — pass only what the route takes
  (e.g. `{ limit: query.limit, page: query.page, status: query.status }`).
- Amounts are decimal STRINGS on the wire (`"100.00"`), never numbers. Ids may be strings (bigint).
- Writes: `useApiMutation({ fn, invalidate: [['paged','admin/...'], ['api','admin/...']], success: '...' })`.
  It toasts errors itself; inside `FormDialog.onSubmit` return `mutation.mutateAsync()` so the dialog stays open on failure.
- Permission gates: `<Can permission='deposits:approve'>…</Can>` or `const { can } = useSession()`.
  Guards per route are in the inventory doc (some are surprising: fiat deposit approve needs `withdrawals:approve`,
  KYC list needs `wallet:read`, P2P reads need `config:write`).
- Binary routes: `api.blob(path)` for CSV/PDF; `api.url(path)` for `<img src>`.
- Unknown/complex payloads: render a proper table for the known columns and a `<JsonView>` for the rest — never invent fields.

## UI rules

- `PageHeader` at top; `DataTable` for lists (server pagination, `onRowClick` to a detail page where one exists).
- Actions live in dialogs (`FormDialog` for forms, `ConfirmDialog` for yes/no). Destructive → `destructive` prop.
- Use `StatusBadge`, `Money`, `DateTime` for status/amount/time cells. Tailwind utilities only, no new CSS files.
- No new dependencies. No `any` — use `Record<string, unknown>` + narrow types for what you render.

## Verify before you finish

```bash
cd site-admin && npx tsc --noEmit                      # must be clean for YOUR files (ignore errors in files you did not touch)
# dev server runs on http://localhost:3000 (start with: npx next dev -p 3000)
curl -s -c /tmp/sa.cookies -X POST localhost:3000/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@ibitplay.local","password":"<super admin password>"}'   # see the gitignored credentials.md
curl -s -b /tmp/sa.cookies -o /dev/null -w "%{http_code}\n" localhost:3000/<your-route>      # expect 200
curl -s -b /tmp/sa.cookies "localhost:3000/api/gw/api/v1/<route>?limit=2"                    # the data your screen reads
```
The backend runs at :4000 (`cd backend && node scripts/dev.js user admin casino sports gateway`). Demo staff:
admin@ibitplay.local (Super Admin) — password: see the gitignored credentials.md (or sign in without seeing it:
`node agents/qa-login.mjs <site> admin superadmin` from the hub). Demo players demo_player01..05 each have their own random password, kept only in the site backend's gitignored
`backend/.demo-credentials.local.md` (written by `node scripts/seed-data.js --demo`). Scripts read it with
`lookupPassword(login)` from `backend/scripts/lib/demo-credentials.js` (never print it); a missing file or account
means: run `node scripts/seed-data.js --demo` first.
