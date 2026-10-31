# Hash Game Exchange — admin

A copy of the hub's `cfz/admins/site-admin`, set up the way `agents/push-admin.mjs` pushes it
(site key `hash-game-exchange`, port pinned in `package.json`, `.env.local` from `.env.example`).
To take a newer hub version, re-copy `site-admin` (without node_modules, .next, .env*) and keep
`package.json`'s name/port, `.env.example` and this file.

```bash
npm install
npm run dev   # http://localhost:3080
```

Talks to the gateway at http://127.0.0.1:4700 (`API_URL`).
