# Setup and scripts

## Requirements

| Tool | Version | Why |
| --- | --- | --- |
| Node | **>= 20.19** | Vite 7 floor; everything else is plain ESM |
| npm | >= 10 | Workspaces |

Developed on Node 24.14 / npm 11.9, Windows 11.

## Install and run

```bash
git clone <your-remote> BitCasino
cd BitCasino
npm install          # installs both workspaces
npm run dev          # web :5173, api :4000
```

Generated assets are committed, so you do not need to run the asset scripts on
a fresh clone.

Open <http://localhost:5173>. The Vite dev server proxies `/api` to the API on
port 4000, so the browser sees a single origin.

## Scripts

Run from the repository root.

| Script | What it does |
| --- | --- |
| `npm run dev` | Web + API together via `concurrently` |
| `npm run dev:web` | Vite dev server only |
| `npm run dev:api` | API only, with `--watch` |
| `npm run build` | Build the web app (the API runs from source, unbuilt) |
| `npm run preview` | Serve the built web app |
| `npm run lint` | ESLint on the web app |
| `npm run assets:gen` | Regenerate placeholder art, icons, favicon, manifest |
| `npm run fonts:fetch` | Re-download and self-host the two open fonts |

Target one workspace directly with `-w`:

```bash
npm run build -w @bc/web
npm run dev -w @bc/api
```

## Environment

The API reads two optional variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | API listen port |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed browser origin |
| `NODE_ENV` | — | `production` switches morgan to `combined` |

No `.env` file is required for local development. If you add one, it is
already gitignored.

## Building for production

```bash
npm run build
```

Produces `apps/web/dist/` (static) and `apps/api/dist/` (compiled JS, run with
`npm start -w @bc/api`).

### Deploying the web app

It is a client-side SPA, so **the host must rewrite unknown paths to
`index.html`** or deep links like `/categories/video-slots` will 404 on
refresh.

- **Netlify** — `_redirects`: `/*  /index.html  200`
- **Vercel** — `vercel.json`: `{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }`
- **nginx** — `try_files $uri $uri/ /index.html;`
- **Apache** — `FallbackResource /index.html`

Also serve `/fonts/*.woff2` with a long `Cache-Control` and the correct
`font/woff2` content type.

## Troubleshooting

**Tailwind classes have no effect.** There is no `tailwind.config.js` — v4 is
configured in CSS. Add tokens to the `@theme` block in
`apps/web/src/styles/index.css`, not to a config file.

**A custom colour utility does nothing.** Check the token is inside
`@theme inline` and named `--color-<name>`. Without `inline`, values are baked
in at build time and theme switching breaks.

**`npm run assets:gen` fails to load the catalog.** It imports
`apps/web/src/data/catalog.js` directly as ESM. Check the file parses on its
own with `node -e "import('./apps/web/src/data/catalog.js')"`.

**API import fails with ERR_MODULE_NOT_FOUND.** The API is native ESM, so
relative imports need an explicit `.js` extension — `./routes/games.js`, not
`./routes/games`.

**Fonts 404 in dev.** Run `npm run fonts:fetch`. Files belong in
`apps/web/public/fonts/`.

**The theme toggle does nothing.** Confirm `<html>` carries `theme-light` or
`theme-dark`. `main.jsx` applies it before render; a stale `index.html` copy
without the class on `<html>` will start unthemed.

## Verified state

As of the last run on this machine:

- `npm run build -w @bc/web` succeeds — 76 modules, 321 KB JS (103 KB gzip),
  39 KB CSS (8 KB gzip).
- `npm start -w @bc/api` boots straight from `src/` — the API has no build step.
- All 11 API endpoint checks pass (health, list, filter, search, detail, 404s,
  400 on invalid query, categories, provider detail, home rails).
- All 51 public assets present; the 3 generated PNGs validate as
  8-bit RGBA with correct signature and IEND chunk.
