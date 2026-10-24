# hash-game-exchange — owner panel

The platform's own panel for this one site (port 3085). It decides what the client is
*entitled* to; see `../docs/OWNER-PANEL.md` for the full contract.

- Login: `OWNER_USERNAME` / `OWNER_PASSWORD` from `.env.local` (no database, no site staff account).
- Data: `data/entitlements.json` and `data/audit.jsonl` (gitignored). Nothing is written to the site.
- Backend pull: `GET /api/entitlements` with `x-owner-key: $OWNER_SHARED_SECRET` → `{ data, signature, signatureEd25519 }`.
  `node scripts/owner-keys.mjs` puts the Ed25519 pair in `.env.local` (private) and `../backend/.env` (public).
- Listens on 127.0.0.1 only (reach it over an SSH tunnel or VPN); failed logins are throttled.

```
npm install
npm run dev        # http://127.0.0.1:3085
npm run check-types && npm run lint
```

## Demo seed (owner side)

`scripts/seed-owner.mjs` puts `data/entitlements.json` into a complete, known demo state the same
way a "Features & plan" save does (version + 1, atomic, mode 600, one `audit.jsonl` line by
`seed-owner`). Every catalogue feature ON with a demo variant (push_notifications = onesignal,
tips = peer_to_peer, …), every flag entitled, policies hybrid / both / both / reward currency USDT,
feature options at their defaults (spin wheel, `bonus.wagering_lock` = on, tournaments page).

```
npm run seed:owner -- --site hash-game-exchange            # dry run: lists what would change
npm run seed:owner -- --site hash-game-exchange --apply    # write it
npm run seed:owner -- --site hash-game-exchange --reset    # dry run of the FULL demo state (overrides owner choices)
npm run seed:owner -- --site hash-game-exchange --data-dir /tmp/owner-copy --apply   # try it on a copy
```

- Default (merge) keeps the owner's choices: a feature or flag switched off, a chosen variant or
  policy, an option value. `--reset` overrides them. Custom coins and keys the catalogue no longer
  lists are never touched. club_membership has no real variant yet and stays off. Re-running is a no-op.
- No secrets are written. The OneSignal App ID + App API key (sealed) and the GTM container ID are
  entered by hand in the site admin → Site Config → Features.
- The backend's admin-service sees the new version on its next poll (`OWNER_POLL_SECONDS`, 15 s);
  other services within `ENTITLEMENTS_TTL_MS` after that. If the owner screen is open, reload it
  before saving (else `VERSION_CONFLICT`).
