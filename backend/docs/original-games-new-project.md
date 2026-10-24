# Original Games — naye project me lagane ka guide

> **Ye doc kya hai:** Parker567 pe abhi Original games (Arrow Bow, Mines, Limbo, Keno, Plinko …) jaise chal rahe hain — backend, admin panel aur website — wahi cheez kisi DOOSRE project me lagane ka step-by-step guide. Doosre project me owner panel nahi hai: sirf ek simple admin panel (listing, stats, on/off) aur website (lobby + game launch).
>
> Provider ki apni puri guide: `backend/docs/original-games-integration-guide.md` (signing, saare error codes, validation run). Ye doc usi ke upar hamara tested tareeka hai.

---

## 1. Kaise chalta hai (ek nazar me)

Ye **seamless wallet** hai: player ka paisa HAMARE wallet me rehta hai, provider ke paas koi balance nahi.

```
Player (website)                 Hamara backend                         Provider (aggregator)
──────────────                   ──────────────                         ─────────────────────
1. Play dabaya  ───────────────► POST /original-games/launch
                                   (login, switch, currency check)
                                   POST /v1/sessions/launch  ──────────► session banata hai
                                 ◄──────────────────────────── launch_url
2. iframe(launch_url) ◄───────── { gameLaunchUrl }
3. Game khelta hai ─────────────────────────────────────────────────────► game server
                                 ◄──── POST {callback}/balance   (signed)
                                 ◄──── POST {callback}/bet       (signed)  → wallet se kato
                                 ◄──── POST {callback}/win       (signed)  → wallet me daalo
                                 ◄──── POST {callback}/rollback  (signed)  → wapas karo
```

- **Hum unhe call karte hain:** game launch (`POST /v1/sessions/launch`) aur game list (`GET /v1/games`). Har request `api_secret` se signed.
- **Wo hume call karte hain:** balance / bet / win / rollback — "wallet callbacks". Har callback `webhook_secret` se signed; hum verify karte hain.
- Launch URL **sirf backend** se maango — `api_secret` kabhi browser me nahi jaana chahiye.

---

## 2. Provider se kya milta hai, unhe kya dena hai

**Unse milta hai (aapke paas pehle se hai):**

| Cheez | Kis kaam ka |
|---|---|
| `api_key` (`ak_...`) | Har request ke `X-API-Key` header me |
| `api_secret` | Hamari requests sign karne ke liye |
| `webhook_secret` | Unke callbacks verify karne ke liye (alag key hai!) |
| API base URL | Sandbox aur production ka alag host |

**Unhe dena hai:**

| Setting | Value |
|---|---|
| `callback_base_url` | `https://<aapka-api-domain>/api/v1/casino/original-games/wallet` |
| `callback_style` | `separate` (har action ka alag path) — hum `unified` (`/transaction`) bhi sambhalte hain |
| `supports_combined_settle` | `false` (settle hum implement nahi karte) |
| `timeout_ms` | `3000` |
| IP whitelist | Aapke **production server ka outgoing IP** (jahan se backend unhe call karega) |
| Currencies | Jo aap chalaoge, jaise `INR`, `USDT` |
| Lobby origin | Aapki website ka domain (iframe ke `frame-ancestors` ke liye — warna iframe blank aayega) |

---

## 3. Env keys (backend `.env`)

```env
OG_BASE_URL=            # PROVIDER ka API host (sandbox ya production), aapka nahi
OG_API_KEY=
OG_API_SECRET=
OG_WEBHOOK_SECRET=
OG_ENV=sandbox          # sandbox → mode "demo" | production → mode "real"
OG_TIMEOUT_MS=10000     # unki API call ka timeout
OG_RETURN_URL=          # optional: game ke andar "lobby" button ka link
OG_DEPOSIT_URL=         # optional: balance kam ho to "deposit" link
OG_VALIDATION_USER_ID=  # optional: unke validation run ka test player → aapka ek test user id
```

- `OG_ENV` key ke hisaab se rakho: **sandbox key = sirf demo** (real bhejoge to `403 MODE_NOT_AVAILABLE`). `mode` kabhi browser se mat lo, backend `OG_ENV` se tay kare.
- Production pe jaate waqt **teeno** (`OG_API_KEY`, `OG_API_SECRET`, `OG_WEBHOOK_SECRET`) ek saath badlo. Sirf key badli aur webhook secret purana raha → har callback reject → poora wallet down dikhega.

---

## 4. Database tables

PostgreSQL. Seedha chala do (ya apne migration me daalo):

```sql
-- Provider ki game list (GET /v1/games) + admin ka har game ka on/off
CREATE TABLE IF NOT EXISTS og_games (
  code       TEXT PRIMARY KEY,                 -- provider ka game_code (bow, mine, limbo …)
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,       -- lobby order
  enabled    BOOLEAN NOT NULL DEFAULT TRUE,    -- admin ka switch (sync isse nahi chhedta)
  data       JSONB NOT NULL DEFAULT '{}'::jsonb, -- provider ki poori row (rtp, limits, status…)
  synced_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Har launch ki ek row; session ki currency launch pe fix ho jaati hai
CREATE TABLE IF NOT EXISTS og_sessions (
  session_id  TEXT PRIMARY KEY,
  user_id     BIGINT NOT NULL,
  game_code   TEXT NOT NULL,
  currency    TEXT NOT NULL,
  mode        TEXT NOT NULL,                   -- demo | real
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_og_sessions_user ON og_sessions (user_id, created_at DESC);

-- Har bet / win / rollback. transaction_id (unka) UNIQUE = double debit/credit kabhi nahi
CREATE TABLE IF NOT EXISTS og_transactions (
  id                        BIGSERIAL PRIMARY KEY,
  transaction_id            TEXT NOT NULL UNIQUE,
  kind                      TEXT NOT NULL CHECK (kind IN ('bet', 'win', 'rollback')),
  status                    TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'noop', 'unfunded')),
  user_id                   BIGINT NOT NULL,
  session_id                TEXT,
  round_id                  TEXT,
  game_code                 TEXT,
  currency                  TEXT NOT NULL,
  amount                    NUMERIC(24, 8) NOT NULL DEFAULT 0,  -- major units (₹ / USDT), direction = kind
  reference_transaction_id  TEXT,                               -- win/rollback → kis bet ka
  balance_after             NUMERIC(24, 8),
  request_json              JSONB,                              -- unka poora body
  response_json             JSONB,                              -- hamara pehla jawab (replay ke liye)
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Ek bet/win ka sirf EK rollback
CREATE UNIQUE INDEX IF NOT EXISTS uq_og_transactions_one_rollback
  ON og_transactions (reference_transaction_id) WHERE kind = 'rollback';
CREATE INDEX IF NOT EXISTS idx_og_transactions_user    ON og_transactions (user_id, currency);
CREATE INDEX IF NOT EXISTS idx_og_transactions_round   ON og_transactions (round_id, kind);
CREATE INDEX IF NOT EXISTS idx_og_transactions_created ON og_transactions (created_at);

-- Callback nonces (replay guard), ~10 min se purane delete kar sakte ho
CREATE TABLE IF NOT EXISTS og_nonces (
  nonce    TEXT PRIMARY KEY,
  seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_og_nonces_seen ON og_nonces (seen_at);
```

Aur ek **site switch** chahiye — "Original games ON/OFF" (admin panel se). Apni settings table me ek boolean, jaise `settings.originals_enabled` (default `true`). Owner panel nahi hai, to bas yahi ek switch.

---

## 5. Signing — dono taraf ek hi formula

```
signing_string = METHOD + "\n" + PATH + "\n" + QUERY + "\n" + X-Timestamp + "\n" + X-Nonce + "\n" + hex(sha256(RAW_BODY))
X-Signature    = "sha256=" + hex(hmac_sha256(secret, signing_string))
```

- PATH = sirf path (host nahi, query nahi). QUERY = raw query string (na ho to khaali).
- **Hamari request** → secret = `api_secret`. **Unka callback verify** → secret = `webhook_secret`.
- **RAW body** ka hash — parse karke dobara `JSON.stringify` mat karna (key order badla to signature fail).

```js
const crypto = require('crypto');

function sign(secret, { method, path, query = '', timestamp, nonce, body = '' }) {
  const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
  const s = [method.toUpperCase(), path, query, timestamp, nonce, bodyHash].join('\n');
  return 'sha256=' + crypto.createHmac('sha256', secret).update(s).digest('hex');
}

/** Provider ko signed call. Non-2xx pe error {status, code}. */
async function ogRequest(method, path, { body, idempotencyKey } = {}) {
  const url = new URL(process.env.OG_BASE_URL.replace(/\/+$/, '') + path);
  const raw = body === undefined ? '' : JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(16).toString('hex');
  const headers = {
    'X-API-Key': process.env.OG_API_KEY,
    'X-Timestamp': timestamp,
    'X-Nonce': nonce,
    'X-Signature': sign(process.env.OG_API_SECRET, { method, path: url.pathname, query: url.search.slice(1), timestamp, nonce, body: raw }),
    ...(raw ? { 'Content-Type': 'application/json' } : {}),
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
  };
  const res = await fetch(url, { method, headers, body: raw || undefined, signal: AbortSignal.timeout(Number(process.env.OG_TIMEOUT_MS || 10000)) });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(json?.error?.message || `OG ${res.status}`), { status: res.status, code: json?.error?.code });
  return json;
}
```

Server ki ghadi **NTP se sync** rakho — 60 sec ka farak hua to har request fail.

---

## 6. Game list sync (provider → `og_games`)

Onboarding ke baad aur jab bhi provider game jode/hataye, ek script chalao (cron ya admin button):

```js
const res = await ogRequest('GET', '/v1/games');
const list = Array.isArray(res) ? res : res.games ?? res.data ?? res.items ?? [];
// har game: { game_code, name, status, rtp, category, supported_currencies, limits: { INR: {min_bet, max_bet, max_win}, … } }
// ek DB transaction me:
//   DELETE FROM og_games WHERE code NOT IN (<naye codes>)          -- jo provider ne hataya
//   INSERT … ON CONFLICT (code) DO UPDATE SET name, position, data, synced_at   -- `enabled` mat chhedna
```

Ek asli row (`data`) aisi dikhti hai:

```json
{ "game_code": "bow", "name": "Arrow Bow", "status": "live", "rtp": "0.9900", "category": "original",
  "supported_currencies": ["INR", "USDT"],
  "limits": { "INR":  { "min_bet": "1000",   "max_bet": "42000000",   "max_win": "4200000000" },
              "USDT": { "min_bet": "100000", "max_bet": "5000000000", "max_win": "500000000000" } } }
```

- Limits **minor units** me hain (INR: paise, USDT: 6 decimal). `1000` paise = ₹10.
- **Provider image nahi bhejta.** Apni images rakho (game_code → image ka map, ya admin se upload).

---

## 7. Backend routes (jo banane hain)

Hamare yahan sab `casino` service me `/api/v1/casino/original-games/...` pe hain. Naye project me koi bhi prefix chalega, bas callback URL provider ko wahi dena.

| Kaun | Method + path | Kya karta hai |
|---|---|---|
| Website (public) | `GET /original-games/games` | Lobby list: `og_games` jo `enabled` hain, `position` order me. Site switch OFF → `[]` |
| Website (login) | `POST /original-games/launch` | Game kholna (section 8) |
| Provider (no login, signed) | `POST /original-games/wallet/balance` `…/bet` `…/win` `…/rollback` | Wallet callbacks (section 9) |
| Provider (unified style) | `POST /original-games/wallet/transaction` | Action body ke `type` me (`BALANCE` / `BET` / `WIN` / `ROLLBACK`) |
| Admin | `GET /admin/original-games/games` · `PUT /admin/original-games/games/:code {enabled}` | Har game ka on/off + listing |
| Admin | `GET /admin/original-games/stats` | Dashboard (section 10) |
| Admin | `GET /admin/original-games/bets` | Bet history (section 10) |

**Callback routes ke liye zaroori:**
- Raw body save karo (signature isi pe). Express: `app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }))`.
- Inpe login / CSRF / API encryption / captcha **mat** lagao. Rate limit dhila rakho (hum 6000/min).
- Agar API gateway response encrypt karta hai to `/wallet/` path ko bypass karo.

---

## 8. Launch — `POST /original-games/launch`

**Website bhejti hai:** `{ "gameCode": "bow", "currencyCode": "INR", "device": "desktop", "language": "en" }` (login token header me; player id **token se**, body se kabhi nahi).

**Backend checks (isi order me):**
1. Keys configured? warna `503 NOT_CONFIGURED`.
2. Site switch ON? warna `403` (Originals off).
3. Game `og_games` me OFF (`enabled = false`)? → `403 GAME_DISABLED`. (List me hi nahi hai to provider khud mana karega.)
4. Currency hamari list me (`INR`, `USDT`)? warna `422`.
5. Player blocked / locked? warna `403`.

**Provider ko call:**

```js
const res = await ogRequest('POST', '/v1/sessions/launch', {
  idempotencyKey: crypto.randomUUID(),            // retry pe WAHI key dobara bhejna
  body: {
    player: { id: String(userId), nickname: username, language },   // id = aapka user id (string)
    game_code: gameCode,
    currency,                                     // INR / USDT — session bhar fix
    mode: process.env.OG_ENV === 'production' ? 'real' : 'demo',
    platform: device,                             // desktop | mobile | tablet
    return_url: process.env.OG_RETURN_URL,        // khaali ho to field hi mat bhejo
    deposit_url: process.env.OG_DEPOSIT_URL,
    session_ttl_seconds: 3600,
  },
});
// res = { session_id, launch_url, launch_token, expires_at, token_expires_at }
await db.query(`INSERT INTO og_sessions (session_id, user_id, game_code, currency, mode)
                VALUES ($1,$2,$3,$4,$5) ON CONFLICT (session_id) DO NOTHING`,
               [res.session_id, userId, gameCode, currency, mode]);
return { gameLaunchUrl: res.launch_url, sessionId: res.session_id, mode };
```

**Errors:** network fail → `502` ("provider not reachable"); unka `503` → maintenance; koi aur 4xx (`GAME_DISABLED`, `CURRENCY_NOT_SUPPORTED`, `MODE_NOT_AVAILABLE` …) → `502` + unka `code` dikhao, **retry mat karo** (setup ki galti hai).

`launch_url` **60 second ke andar** iframe me load karna hai (token ek baar chalta hai).

---

## 9. Wallet callbacks — sabse zaroori hissa

### 9.1 Har callback pe pehle verify

```js
async function verify(req) {                       // null = theek; warna 401 ka jawab
  const ts = String(req.headers['x-timestamp'] ?? '');
  const nonce = String(req.headers['x-nonce'] ?? '');
  const sent = String(req.headers['x-signature'] ?? '');
  const [path, query = ''] = req.originalUrl.split('?');
  const expected = sign(process.env.OG_WEBHOOK_SECRET, { method: req.method, path, query, timestamp: ts, nonce, body: req.rawBody ?? Buffer.alloc(0) });
  const same = crypto.timingSafeEqual(sha(sent), sha(expected));          // constant-time
  if (!sent || !same) return { error_code: 'INVALID_SIGNATURE' };
  if (!(Math.abs(Date.now() / 1000 - Number(ts)) <= 60)) return { error_code: 'REQUEST_EXPIRED' };
  if (nonce.length < 16) return { error_code: 'REPLAY_DETECTED' };
  const fresh = await db.query('INSERT INTO og_nonces (nonce) VALUES ($1) ON CONFLICT DO NOTHING RETURNING nonce', [nonce]);
  if (!fresh.rowCount) return { error_code: 'REPLAY_DETECTED' };
  return null;
}
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
```

Verify fail → **HTTP 401** `{ "status": "ERROR", "error_code": "INVALID_SIGNATURE" }`. Keys hi set nahi → `503 { status: "ERROR", error_code: "MAINTENANCE" }`.

### 9.2 Paisa: minor units ↔ hamara decimal

Provider har `amount` aur hum har `balance` **integer minor units** me bhejte hain.

| Currency | Exponent | ₹/USDT 1.00 = |
|---|---|---|
| INR | 2 | `100` |
| USDT | 6 | `1000000` |

- Aate waqt: `amount / 10^exp` → decimal (sirf non-negative integer accept karo, warna `INTERNAL_ERROR`).
- Jaate waqt: `balance * 10^exp`, **neeche round** (kabhi zyada mat batao), kabhi negative nahi.

### 9.3 Har callback ka common flow

1. `verify` (upar).
2. `currency` hamari list me nahi → `CURRENCY_MISMATCH`.
3. `player_id` → aapka user id. Validation run ka player `__aggregator_validation__` aaye to `OG_VALIDATION_USER_ID` wala user use karo. User nahi mila → `PLAYER_NOT_FOUND`.
4. `session_id` ki row hai aur uska user alag hai → `SESSION_EXPIRED`; currency alag → `CURRENCY_MISMATCH`.
5. Action chalao (neeche). Jawab `og_transactions.response_json` me save karo (jahan abhi khaali hai).

**Jawab ka format** — hamesha HTTP 200:

```json
{ "status": "OK", "balance": 1245000, "currency": "INR", "operator_tx_id": "og-5512" }
{ "status": "ERROR", "error_code": "INSUFFICIENT_FUNDS", "balance": 1200, "currency": "INR" }
```

Business wala error bhi **200** hai (`status: "ERROR"`); sirf signature wala 401. Koi bhi andar ka crash → `200 { status: "ERROR", error_code: "INTERNAL_ERROR" }` + log.

### 9.4 Balance

Read-only: `{ status: "OK", balance, currency }`.

### 9.5 Bet (debit)

1. `transaction_id` pehle se `og_transactions` me? → **wahi purana jawab** do (us waqt ka `balance_after` aur wahi `operator_tx_id`). Error kabhi nahi, dobara kato kabhi nahi.
2. Is bet ka rollback pehle hi aa chuka? (`kind='rollback' AND reference_transaction_id = txId`) → `INTERNAL_ERROR`, kuch mat kato.
3. Player blocked → `PLAYER_BLOCKED`. Site switch OFF → `MAINTENANCE` (naye bet band; chalte round settle hote rahenge).
4. **Ek DB transaction me:** pehle `og_transactions` row (`kind='bet'`) INSERT, phir wallet se debit. Balance kam → transaction rollback, jawab `INSUFFICIENT_FUNDS` + current balance — **kuch bhi nahi katna** (provider round void karega, rollback nahi bhejega).
5. Unique index pe duplicate error (doosri copy jeet gayi) → us row ka jawab replay karo.
6. OK → `balance_after` update, jawab `{ status: "OK", balance, currency, operator_tx_id: "og-<row id>" }`.
7. (Optional) aapke project me VIP / wager / rakeback hai to yahin bet record karo.

### 9.6 Win (credit)

Bet jaisa hi (dedupe → insert → credit). **`amount: 0` wala win bhi aata hai** (round band karne ke liye) — row likho, paisa mat hilao, `200 OK`.

### 9.7 Rollback — 3 rules (yahi sabse zyada galat hota hai)

1. Same rollback `transaction_id` dobara, ya `reference_transaction_id` ka rollback pehle ho chuka → `200 OK` + current balance. **Do baar wapas kabhi nahi.**
2. `reference_transaction_id` hamare paas nahi (ya kisi aur player ka) → ek `status='noop'` rollback row likho, `200 OK`. Baad me wo bet aaye to refuse (9.5 step 2).
3. Mila → **HAMARA likha amount** wapas karo (request ka amount nahi): bet ka rollback = credit, win ka rollback = debit. Win ka paisa player kharch kar chuka (balance kam) → `status='unfunded'` row, `200 OK`, aur **operator ko alert** (manual hisaab). Rollback me bet record (VIP/wager) bhi wapas karo.

Full round void me pehle win ka rollback, phir bet ka — do alag calls.

### 9.8 Error codes jo hum bhejte hain

`INSUFFICIENT_FUNDS`, `PLAYER_NOT_FOUND`, `PLAYER_BLOCKED`, `SESSION_EXPIRED`, `CURRENCY_MISMATCH`, `MAINTENANCE`, `INTERNAL_ERROR`. Koi aur bheja to provider `INTERNAL_ERROR` maanta hai.

### 9.9 Wallet ke liye 3 baatein

- Debit/credit aur `og_transactions` INSERT **ek hi DB transaction** me — dono hon ya koi nahi.
- Debit pe row lock (`SELECT … FOR UPDATE`) ya `UPDATE … WHERE balance >= amount` — balance kabhi negative na ho.
- Player ki statement me game ka naam likho (`og_games.name` + "bet"/"win"), transaction id nahi.

Bet / win / settle player ke request path me hain — **3 sec ke andar** jawab do.

---

## 10. Admin panel (simple)

Hamare admin me 4 page hain: **Dashboard, Turnover, Bet history, Games** + Features me har game ka switch. Naye project ke liye ye kaafi hai:

### 10.1 Original games ON/OFF (settings)
Ek switch → `settings.originals_enabled`. OFF = lobby khaali, launch `403`, naya bet `MAINTENANCE`; chal rahe round settle hote rahenge.

### 10.2 Games (listing + har game ka switch)

```sql
SELECT g.code, g.name, g.enabled, g.data, g.synced_at,
       COUNT(t.id)::int               AS bets,
       COUNT(DISTINCT t.user_id)::int AS players,
       MAX(t.created_at)              AS last_bet_at
  FROM og_games g
  LEFT JOIN og_transactions t ON t.game_code = g.code AND t.kind = 'bet' AND t.status = 'applied'
 GROUP BY g.code ORDER BY g.position, g.code;
```

Columns: image, naam, code, RTP (`data.rtp`), status (`data.status`), currencies, limits (minor → major), bets, players, last bet, **switch** (`PUT … { enabled }` → `UPDATE og_games SET enabled = $1 WHERE code = $2`). Upar ek "Sync games" button (section 6).

### 10.3 Dashboard / stats

Ek round = ek `bet` + uska `win` (same `round_id`). Loss = win 0. Jo bet/win rollback ho gaya wo **refund** hai, wagered/won me nahi gina jaata. **GGR = wagered − won** (house ka profit). Margin = GGR / wagered.

```sql
-- o = window ki rows + "rollback hua?" flag
WITH o AS (
  SELECT t.*, EXISTS (SELECT 1 FROM og_transactions r
                       WHERE r.kind = 'rollback' AND r.status = 'applied'
                         AND r.reference_transaction_id = t.transaction_id) AS rb
    FROM og_transactions t
   WHERE t.kind IN ('bet','win') AND t.status = 'applied'
     AND t.created_at >= $1 AND t.created_at < $2
     AND t.currency = $3                                   -- har currency alag dikhao
)
SELECT
  COUNT(*)            FILTER (WHERE kind='bet' AND NOT rb)                 AS bets,
  COALESCE(SUM(amount) FILTER (WHERE kind='bet' AND NOT rb), 0)            AS wagered,
  COALESCE(SUM(amount) FILTER (WHERE kind='win' AND NOT rb), 0)            AS won,
  COUNT(*)            FILTER (WHERE kind='win' AND amount > 0 AND NOT rb)  AS paid_wins,
  COUNT(*)            FILTER (WHERE kind='bet' AND rb)                     AS refunds,
  COUNT(DISTINCT user_id) FILTER (WHERE kind='bet')                        AS players
FROM o;
```

Isi query me `GROUP BY date_trunc('day', created_at)` = chart, `GROUP BY game_code` = per game table, `GROUP BY currency` = per currency. Dikhane layak: Wagered, Won, GGR, Margin, Bets, Players, Avg bet (wagered/bets), Win rate (paid_wins/bets). INR aur USDT ko jodna ho to rate se ek currency me badlo, warna alag-alag dikhao.

### 10.4 Bet history (ek row = ek round)

```sql
SELECT b.created_at, b.user_id, u.username, COALESCE(g.name, b.game_code) AS game, b.currency,
       b.amount AS stake, w.payout, COALESCE(w.balance_after, b.balance_after) AS balance_after,
       b.round_id, b.transaction_id,
       CASE WHEN rb.id IS NOT NULL THEN 'refunded'
            WHEN w.payout IS NULL  THEN 'open'
            WHEN w.payout > 0      THEN 'won' ELSE 'lost' END AS result
  FROM og_transactions b
  JOIN users u ON u.id = b.user_id
  LEFT JOIN og_games g ON g.code = b.game_code
  LEFT JOIN LATERAL (
    SELECT SUM(x.amount) AS payout, (ARRAY_AGG(x.balance_after ORDER BY x.id DESC))[1] AS balance_after
      FROM og_transactions x
     WHERE x.kind = 'win' AND x.status = 'applied' AND x.round_id = b.round_id AND x.user_id = b.user_id
    HAVING COUNT(*) > 0
  ) w ON TRUE
  LEFT JOIN og_transactions rb ON rb.kind = 'rollback' AND rb.status = 'applied' AND rb.reference_transaction_id = b.transaction_id
 WHERE b.kind = 'bet' AND b.status = 'applied'
 ORDER BY b.created_at DESC
 LIMIT $1 OFFSET $2;
```

Player P/L = payout − stake (refunded/open me khaali). Filters: date, game, currency, result, search (user id / username / round id / txn id).

Admin ke ye routes sirf admin login + permission ke saath.

---

## 11. Website

**Lobby (Originals row):** `GET /original-games/games` → `[{ game_code, name, image }]`. Tile pe apni image (code se map). List khaali = row mat dikhao (switch OFF).

**Game page (`/game/<code>`):**
1. "Play" dabaya → login nahi hai to login dialog.
2. `POST /original-games/launch` with `{ gameCode, currencyCode, device, language }`:
   - `currencyCode` = player ka chuna hua wallet (INR / USDT); doosri currency pe "INR ya USDT chuno" bolo.
   - `device` = `mobile` / `tablet` / `desktop` (screen width se).
3. Jawab ka `gameLaunchUrl` turant iframe me:

```html
<iframe src="{gameLaunchUrl}" allow="autoplay; clipboard-read; clipboard-write" allowfullscreen></iframe>
```

   `sandbox` attribute mat lagao (game ko scripts/storage chahiye). Mobile pe chaaho to seedha redirect bhi kar sakte ho.
4. Launch fail → "Game abhi available nahi" message; `403` (switch off) pe game chhupa do.
5. Khelte waqt header balance apne wallet se refresh karo (har bet/win hamare wallet me hi hota hai).

---

## 12. Go-live checklist

**Sandbox (demo) me:**
- [ ] Tables bani, env me sandbox keys, `OG_ENV=sandbox`.
- [ ] Game sync chala, `og_games` me games aaye.
- [ ] Callback URL provider ko diya; server IP whitelist; lobby domain diya.
- [ ] Ek demo game khola — launch chala (demo me wallet call nahi aata).
- [ ] Provider ka validation run (`POST /v1/validation/runs`, guide §9) — 17 case green: signature, balance, insufficient funds (kuch nahi kata), bet dedupe, rollback unknown, rollback repeat, zero win, balance kabhi negative nahi.
- [ ] Apna result file provider ko bhejo (guide §9 ka format).

**Production:**
- [ ] Teeno production keys ek saath + `OG_ENV=production` + production `OG_BASE_URL`.
- [ ] Production server ka outgoing IP whitelist.
- [ ] Ek chhota real bet: wallet kata, win aaya, admin bet history me row, statement me game ka naam.
- [ ] Har currency (INR, USDT) me ek baar real launch (pehli baar `CURRENCY_VALIDATION_REQUIRED` aa sakta hai — guide §11).

---

## 13. Jo galtiyan sabse zyada hoti hain

- Body parse karke dobara stringify karke hash → signature fail. **Raw body** use karo.
- Server clock 60 sec se zyada aage/peeche → har request fail.
- Insufficient funds pe bhi kuch kaat liya → paisa gaya, provider rollback nahi bhejega.
- Duplicate `transaction_id` pe error de diya → provider retry karega; **purana jawab** do.
- Rollback me request ka amount use kiya → hamesha **apna likha amount**.
- Callback route pe login/CSRF/encryption laga diya → saare callbacks fail.
- Production key ke saath sandbox webhook secret → har callback 401.
- Lobby domain provider ko nahi diya → iframe blank.
- Launch URL 60 sec baad load kiya → token expire.

---

## 14. Parker567 me code kahan hai (copy karne ke liye)

| Kya | File |
|---|---|
| Launch + callbacks + sync (poora logic) | `backend/services/casino/src/modules/original-games/originalGames.service.js` |
| Signing + provider client | `backend/services/casino/src/modules/original-games/provider/client.js` |
| Routes (public / user / admin switch) | `backend/services/casino/src/modules/original-games/routes/*.js` |
| Currencies, error codes, limits | `backend/services/casino/src/modules/original-games/originalGames.constants.js` |
| Admin stats / bet history / games | `backend/services/admin/src/modules/original-games/originalGames.service.js` |
| Tables | `backend/packages/db/migrations/130-original-games.js`, `131`, `133`, `139`, `146` (`og_games.enabled`) |
| Game sync script | `backend/scripts/sync-original-games.js` |
| Tests (dedupe, rollback, signature …) | `backend/services/casino/src/modules/original-games/__tests__/originalGames.test.js` |
| Admin UI | `admin/src/views/casino/OriginalGames.tsx`, switch: `admin/src/views/site-config/Features.tsx` |
| Website: list / launch / iframe | `frontend/src/services/originals.js`, `frontend/src/services/game.js`, `frontend/src/pages/Game/index.jsx` |

Parker567 me jo cheezein naye project me **nahi** chahiye: owner panel ka "Originals" plan flag, agent tree ke points ledger (`addChildGamePoints`), aur VIP / rakeback / affiliate wager recording (aapke project me ye features hon to bet pe record karo, rollback pe wapas).
