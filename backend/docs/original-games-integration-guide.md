# Original Games Aggregator — Integration Guide

Everything a partner needs to integrate: credentials, request signing, the game launch API, and the wallet callbacks your backend must implement. Amounts are integers in minor units throughout; timestamps are RFC 3339 UTC.

## 1. How the integration works

The platform uses a seamless wallet. Player funds stay on YOUR side: we never hold a balance. Money moves in two directions —

- **You call us** to launch games and to query sessions, transactions and reports (section 4).
- **We call you** for every balance read, bet, win and rollback — the wallet callbacks your backend implements (section 5). Your response is authoritative; our ledger mirrors it.

### Launch flow, end to end

1. A player opens a game in your lobby.
2. Your backend calls `POST /v1/sessions/launch` with the player, game and currency.
3. We return a `launch_url`. You load it in an iframe (or redirect on mobile).
4. The game frontend connects to us and exchanges its single-use launch token for a session.
5. During play, we call your wallet endpoints: `balance`, `bet`, `win`, `rollback`.
6. You reconcile at any time via `GET /v1/transactions/{id}` and the reports API.

> **Important:** The launch URL must be requested by your BACKEND, never from the browser: the request is signed with your `api_secret`, and that secret must never reach a client device.

## 2. What we exchange at onboarding

### You receive from us

| Item | Form | Purpose |
| --- | --- | --- |
| `api_key` | `ak_` + 43 chars | Public identifier, sent in the `X-API-Key` header. |
| `api_secret` | 32 random bytes | Signs your requests to us. Shown once at creation — store it in a secrets manager, never in code or the browser. |
| `webhook_secret` | 32 random bytes | Verifies OUR callbacks to you. Separate key, rotated separately. |
| API base URL | per environment | Staging first, production at go-live. |
| Game catalogue | via `GET /v1/games` | Game codes, limits and currencies enabled for you. |

### You provide to us

| Setting | Example | Notes |
| --- | --- | --- |
| `callback_base_url` | `https://wallet.example.com/aggregator` | Where we send wallet callbacks. http or https; use https in production. |
| `callback_style` | `separate` or `unified` | Separate paths per action, or one `/transaction` endpoint. |
| `supports_combined_settle` | `true` / `false` | Set `true` only if you can apply debit+credit atomically (section 5.5). |
| `timeout_ms` | `3000` | How long we wait on your wallet. Hard cap 10000. |
| IP whitelist | list of CIDRs | The only addresses your API calls may come from. |
| Enabled currencies | any subset of the 65 | Agreed at onboarding — tell us which of the 65 you settle in and we enable exactly those; all of them is a normal answer. Widened or narrowed later on request. You send one code per launch, not a list — see section 6. |

Two `api_key`s can be active at once, so keys rotate with zero downtime: add the new key, move traffic, revoke the old one.

## 3. Authenticating your requests

Every request to us carries four headers:

```text
X-API-Key:    ak_9tRq...            your api_key
X-Timestamp:  1754179200            unix seconds
X-Nonce:      3f9a1c2e...           16+ random bytes, hex
X-Signature:  sha256=1a2b3c...      HMAC, construction below
Idempotency-Key: <your key>         required on POST /sessions/launch
                                    and money-affecting POSTs
```

### Signature

```text
signing_string = HTTP_METHOD + "\n"
               + REQUEST_PATH + "\n"     (path only, no host, no query)
               + QUERY_STRING + "\n"     (raw; empty string if none)
               + X-Timestamp + "\n"
               + X-Nonce + "\n"
               + hex(sha256(RAW_REQUEST_BODY))

X-Signature = "sha256=" + hex(hmac_sha256(api_secret, signing_string))
```

Sign the RAW request body — the exact bytes you send, before any re-serialisation. The `Idempotency-Key` header is not part of the signing string.

### Authentication failures

| Status | Code | Meaning |
| --- | --- | --- |
| 401 | `INVALID_API_KEY` | Key unknown or revoked. |
| 403 | `IP_NOT_WHITELISTED` | Source address not in your whitelist. |
| 401 | `REQUEST_EXPIRED` | `X-Timestamp` differs from our clock by more than 60 s. |
| 401 | `REPLAY_DETECTED` | Nonce reused within 120 s. |
| 401 | `INVALID_SIGNATURE` | HMAC mismatch — check raw-body hashing first. |
| 403 | `OPERATOR_SUSPENDED` | Account not active. Permanent until resolved commercially — do not retry. |
| 503 | `OPERATOR_MAINTENANCE` | Temporary; honours `Retry-After`. |

## 4. Launching a game

`POST /v1/sessions/launch` creates a play session and returns the URL to load. The `Idempotency-Key` header is REQUIRED: reuse the same key verbatim when retrying after a timeout, and the retry returns the original session instead of minting a second one.

**Request**

```json
{
  "player": {
    "id": "player-99213",
    "nickname": "luckyjoe",
    "country": "IN",
    "language": "en"
  },
  "game_code": "crash",
  "currency": "INR",
  "mode": "real",
  "platform": "mobile",
  "return_url": "https://casino.example.com/lobby",
  "deposit_url": "https://casino.example.com/cashier",
  "session_ttl_seconds": 3600,
  "context": {
    "affiliate_id": "aff-77"
  }
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `player.id` | yes | Your player ID, stable per player, max 128 chars. Unknown IDs are created on first launch. |
| `game_code` | yes | From `GET /v1/games`. Must be enabled for you. |
| `currency` | yes | One code from the list in section 6, chosen per launch. Fixed for the whole session — it is not converted. |
| `mode` | yes | `real` or `demo`. Demo never calls your wallet — players get a local play-money balance. |
| `player.country` | no | ISO-3166-1 alpha-2. Used for game availability rules. |
| `player.language` | no | ISO-639-1. Falls back to your default. |
| `platform` | no | `desktop` \| `mobile` \| `tablet`. |
| `return_url` | no | Lobby link shown inside the game. |
| `deposit_url` | no | Shown to the player on insufficient funds. |
| `session_ttl_seconds` | no | 300–86400, default 3600. Out-of-range values are clamped, not rejected. |
| `context` | no | Opaque object; stored on the session and echoed back in every wallet callback. |

> **Important:** Currency is chosen PER LAUNCH, not per integration. The same `api_key` opens one session in INR, the next in BRL and the next in BTC, all live at the same time — there is nothing to reconfigure between them and no per-currency credential. What is fixed is the SESSION: its currency is frozen at launch, every wallet callback in it carries that code, and returning a different one is `CURRENCY_MISMATCH` rather than a conversion. Section 6 has the full list of 65 and their exponents.

> **Important:** A SANDBOX credential opens `demo` sessions only. `mode: "real"` on one is refused `403 MODE_NOT_AVAILABLE`, and there is no account state in which that changes — it is not a gate that opens at `validated` or `active`, because the rule is a property of the credential rather than of your lifecycle. Gather your `launch.succeeded` evidence in demo: it runs against a play-money store that branches away from the ledger, so it exercises the whole launch path without moving money through an unvalidated integration. Real-money play is what PRODUCTION credentials are for, and one cannot be issued until you are validated. Decide mode from the credential you hold, not from your own environment setting: we read the environment from the `api_key` row and do not consult an environment field in the request body. And treat the refusal as a configuration error rather than a busy provider — it is a 422 with a specific remedy that cannot fix itself, so mapping it onto "provider unavailable" tells the player the game is down and retries a configuration that will fail identically forever. Retrying it also feeds `errors.handled` in section 9, which gates the activation you are retrying towards.

**Response 201**

```json
{
  "session_id": "0198e2b1-77c4-7b1a-9a0e-2f1c9d3a4b5e",
  "launch_url": "https://games.<platform>/crash/?token=lt_7dK2...&lang=en",
  "launch_token": "lt_7dK2...",
  "expires_at": "2026-08-03T15:22:31.482Z",
  "token_expires_at": "2026-08-03T14:23:31.482Z"
}
```

Load `launch_url` within 60 seconds: the launch token inside it is single-use with a 60 s TTL. It authorises the game handshake only — the session itself lives for `session_ttl_seconds`. A replayed launch returns the stored `201` with an `Idempotency-Replayed: true` header.

### Launch errors

| Status | Code | When |
| --- | --- | --- |
| 400 | `IDEMPOTENCY_KEY_REQUIRED` | Header missing or over 128 chars. |
| 400 | `VALIDATION_FAILED` | Malformed field; `player.id`, `game_code`, `currency` are required. |
| 403 | `GAME_DISABLED` | Game unknown, unpublished, or not enabled for you. |
| 403 | `GAME_NOT_LICENSED_IN_COUNTRY` | Game refused for `player.country`. |
| 403 | `PLAYER_BLOCKED` | Player blocked or self-excluded. |
| 409 | `REQUEST_IN_PROGRESS` | Same key mid-flight. Retry shortly. |
| 409 | `IDEMPOTENCY_KEY_REUSED` | Same key with a DIFFERENT body. |
| 422 | `CURRENCY_NOT_SUPPORTED` | Currency not enabled for you, or no limits published for it on this game. |
| 422 | `CURRENCY_VALIDATION_REQUIRED` | Currency IS enabled for you, but no wallet probe has passed at its exponent. Run one — see section 9. `details.validated` names what you can use now. |
| 422 | `INVALID_MODE` | `mode` is neither `real` nor `demo`. |
| 503 | `OPERATOR_MAINTENANCE` / `GAME_MAINTENANCE` | Temporary; honours `Retry-After`. |

### Session management

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/sessions/{id}/close` | Force-terminate (logout, self-exclusion, fraud hold). Open rounds are voided through the rollback path and listed in the response. Closing twice returns `200` with `already_closed: true`. |
| `GET /v1/sessions/{id}` | Session state for support tooling: status, activity, bet/win totals. |

## 5. Wallet callbacks — what your backend implements

We call these on your `callback_base_url` during play. With `callback_style: separate` (the default) each action has its own path; with `unified` we POST everything to `{base}/transaction` with a `type` field of `BALANCE`, `BET`, `WIN`, `ROLLBACK` or `SETTLE` — payloads are otherwise identical.

| Purpose | Path |
| --- | --- |
| Balance | `POST {base}/balance` |
| Debit (bet) | `POST {base}/bet` |
| Credit (win) | `POST {base}/win` |
| Reverse | `POST {base}/rollback` |
| Combined debit+credit | `POST {base}/settle` — only if `supports_combined_settle` |

### 5.0 Verifying our signature

Every callback carries `X-Signature`, `X-Timestamp`, `X-Nonce` and `X-Request-Id`. The signature uses the SAME construction as section 3, keyed with your `webhook_secret`. You MUST: recompute the HMAC and compare in constant time; reject timestamps older than 60 s; reject a nonce seen in the last 120 s. Skipping verification means accepting arbitrary balance mutations from anyone who learns your callback URL.

### 5.1 Balance

**POST {base}/balance**

```json
{
  "request_id": "01J8Z6QK...",
  "client_id": "cl_9f21",
  "player_id": "player-99213",
  "session_id": "0198e2b1-77c4-7b1a-9a0e-2f1c9d3a4b5e",
  "currency": "INR",
  "game_code": "crash",
  "timestamp": "2026-08-03T14:31:08.900Z"
}
```

**Response 200**

```json
{ "status": "OK", "balance": 1250000, "currency": "INR" }
```

Read-only, freely retryable. `player_id` in callbacks is always YOUR player ID — the one you sent at launch.

### 5.2 Bet (debit)

**POST {base}/bet**

```json
{
  "request_id": "01J8Z6QK...",
  "transaction_id": "8f14e45f-ea6d-5a2b-9c3d-1b7f2a6e0c11",
  "client_id": "cl_9f21",
  "player_id": "player-99213",
  "session_id": "0198e2b1-...",
  "round_id": "rnd-88213",
  "game_code": "crash",
  "amount": 5000,
  "currency": "INR",
  "is_round_start": true,
  "timestamp": "2026-08-03T14:31:09.004Z",
  "context": {
    "affiliate_id": "aff-77"
  }
}
```

**Response 200**

```json
{
  "status": "OK",
  "balance": 1245000,
  "currency": "INR",
  "operator_tx_id": "op-tx-5512390"
}
```

> **Important:** `transaction_id` is the dedupe key. If you have already applied it, return `200` with the ORIGINAL result — the balance after the first application and the same `operator_tx_id`. Never debit twice, and never return an error for a repeat.

Insufficient funds is a business answer, not a transport failure — return it as `200` with an error status (a `4xx` with the same body also works):

```json
{ "status": "ERROR", "error_code": "INSUFFICIENT_FUNDS", "balance": 1200, "currency": "INR" }
```

### 5.3 Win (credit)

**POST {base}/win**

```json
{
  "request_id": "01J8Z6QM...",
  "transaction_id": "3c9a1de4-5b62-5f18-8d41-9e0b2c7a6d33",
  "reference_transaction_id": "8f14e45f-ea6d-5a2b-9c3d-1b7f2a6e0c11",
  "client_id": "cl_9f21",
  "player_id": "player-99213",
  "session_id": "0198e2b1-...",
  "round_id": "rnd-88213",
  "game_code": "crash",
  "amount": 12500,
  "currency": "INR",
  "is_round_end": true,
  "multiplier": "2.50",
  "timestamp": "2026-08-03T14:31:24.610Z"
}
```

`reference_transaction_id` links the win to its bet. A ZERO win is still sent (`amount: 0`, `is_round_end: true`) so you can close the round on your side — ignore the row if you like, but return `200`.

### 5.4 Rollback

**POST {base}/rollback**

```json
{
  "request_id": "01J8Z6QP...",
  "transaction_id": "b1d2f8a0-77c4-5e3a-9012-4c6d8e1f0a22",
  "reference_transaction_id": "8f14e45f-ea6d-5a2b-9c3d-1b7f2a6e0c11",
  "client_id": "cl_9f21",
  "player_id": "player-99213",
  "session_id": "0198e2b1-...",
  "round_id": "rnd-88213",
  "game_code": "crash",
  "amount": 5000,
  "currency": "INR",
  "reason": "GAME_ERROR",
  "timestamp": "2026-08-03T14:33:02.775Z"
}
```

`reason` is one of `GAME_ERROR`, `TIMEOUT`, `DUPLICATE`, `SESSION_CLOSED`, `ADMIN_VOID`, `ROUND_CANCELLED`. Three behaviours are mandatory — this is the part integrations most often get wrong:

1. Unknown `reference_transaction_id` → return `200 OK`, not 404. The original bet may never have reached you; record it as a no-op, and reject the original bet if it arrives later.
2. Already rolled back → return `200 OK` with the current balance. Never reverse twice.
3. A full round void reverses win first, then bet — we send two separate rollback calls in that order.

### 5.5 Settle — combined debit + credit (optional)

For instant-settle games, one round trip instead of two. Enable it only if you apply both legs atomically — either both land or neither. Insufficient funds rejects the whole settle.

**POST {base}/settle**

```json
{
  "request_id": "01J8Z6QR...",
  "client_id": "cl_9f21",
  "player_id": "player-99213",
  "session_id": "0198e2b1-...",
  "round_id": "rnd-88999",
  "game_code": "dice",
  "currency": "INR",
  "bet": {
    "transaction_id": "1a...",
    "amount": 5000
  },
  "win": {
    "transaction_id": "2b...",
    "amount": 9800
  },
  "timestamp": "2026-08-03T14:35:10.220Z"
}
```

**Response 200**

```json
{
  "status": "OK",
  "balance": 1249800,
  "currency": "INR",
  "bet_operator_tx_id": "op-tx-5512401",
  "win_operator_tx_id": "op-tx-5512402"
}
```

### 5.6 Error codes you may return

| `error_code` | Meaning | Our reaction |
| --- | --- | --- |
| `INSUFFICIENT_FUNDS` | Balance too low | Bet rejected, cashier link shown, round voided. No rollback follows. |
| `PLAYER_NOT_FOUND` | Unknown player | Session terminated. |
| `PLAYER_BLOCKED` | Suspended / self-excluded | Session terminated, open round voided. |
| `SESSION_EXPIRED` | You ended the session | Session terminated, open round voided. |
| `CURRENCY_MISMATCH` | Wrong currency for player | Session terminated; flagged as a configuration bug. |
| `BET_LIMIT_EXCEEDED` | Your side limit | Bet rejected, message surfaced to player. |
| `TRANSACTION_NOT_FOUND` | Rollback target unknown | Treated as success (rule 1 above). |
| `MAINTENANCE` | Your wallet is down | Retried, then round voided. |
| `INTERNAL_ERROR` | Your side failed | Retried, then parked for reconciliation. |

Anything unrecognised is treated as `INTERNAL_ERROR`.

### 5.7 Timeouts, retries, ordering

- Bet / win / settle sit in the player’s request path: respond within your `timeout_ms` (default 3 s) at p99.
- We retry a money call exactly once, and only on connection-level failure — never on a read timeout, since you may already have applied it.
- Rollbacks and zero-value wins are delivered asynchronously with backoff (`+1s, +5s, +15s, +5m`, then a dead-letter queue we replay manually). A rollback is never abandoned.
- Within one `round_id`, callbacks are strictly ordered: `BET` → `WIN` → (`ROLLBACK`). Across rounds there is NO ordering guarantee.
- Repeated failures open a circuit breaker on our side: launches are refused with `503 OPERATOR_MAINTENANCE` until your wallet recovers.

## 6. Money, identifiers, timestamps

- `amount` is a JSON integer in MINOR units, always positive — direction is carried by the transaction type, never the sign. Currency exponent comes from the currency itself (EUR→2, JPY→0), not assumed to be 2.
- `currency` is one of the 65 codes below, uppercase. Most are ISO-4217 alpha-3; the crypto codes are not ISO-4217 and are longer than three characters, so do not validate against a three-letter pattern. A session’s currency is fixed at launch; returning a different one is a hard error (`CURRENCY_MISMATCH`), never a conversion.
- Balances you return are your post-transaction balance, echoed as-is.
- Timestamps are RFC 3339 UTC with milliseconds: `2026-08-03T14:22:31.482Z`.
- Two of your player IDs never collide with another operator’s: everything is keyed on the pair (your account, your `player.id`).
- `transaction_id` (ours, UUID) is the dedupe key. `operator_tx_id` (yours, ≤128 chars) is stored for reconciliation.
- Unknown JSON fields must be ignored — additive fields do not bump the API version.

### The 65 currencies we support

Every game is priced in every one of them, so any currency your account has enabled is playable across the whole catalogue — pick a code per launch and settle in it. You do not send us a list, and you are not choosing one currency for your integration: your account runs as many of them side by side as you have enabled. A player is not tied to a currency either — the same player can open one session in INR and the next in BTC. Which codes your account has is agreed at onboarding; `GET /v1/games` is what it actually is.

**The exponent is how many minor units make one major unit**, and it is the one thing to get right. Every `amount` we send and every `balance` you return is an integer of minor units. Read the exponent from this table rather than assuming two — assuming two turns ¥500 into ¥5 and 1 BTC into 0.00000001 BTC.

| Exponent | Codes | 1.00 is sent as |
| --- | --- | --- |
| **0** | `CLP` `ISK` `JPY` `KRW` `VND` | `1` |
| **2** | `AED` `ARS` `AUD` `BDT` `BRL` `CAD` `CHF` `CNY` `COP` `CZK` `DKK` `EGP` `EUR` `GBP` `HKD` `HUF` `IDR` `ILS` `INR` `KES` `KZT` `LKR` `MXN` `MYR` `NGN` `NOK` `NZD` `PEN` `PHP` `PKR` `PLN` `RON` `RUB` `SAR` `SEK` `SGD` `THB` `TRY` `UAH` `USD` `ZAR` | `100` |
| **3** | `BHD` `JOD` `KWD` `OMR` `TND` | `1000` |
| **6** | `ADA` `TRX` `USDC` `USDT` `XRP` | `1000000` |
| **8** | `BCH` `BNB` `BTC` `DAI` `DOGE` `ETH` `LTC` `MATIC` `SOL` | `100000000` |

> **Important:** Store the exponent per currency, not per integration. Nine of these are 8-decimal crypto and five are 0-decimal, so a wallet that hardcodes two is wrong for fourteen of the sixty-five — and wrong by a factor of a hundred million at the worst of them. `wallet.balance` in section 9 checks this.

**The same stake, three currencies**

```json
{ "currency": "JPY",  "amount": 500 }        // ¥500
{ "currency": "INR",  "amount": 50000 }      // ₹500.00
{ "currency": "BTC",  "amount": 50000000 }   // 0.5 BTC
```

The authoritative list is `GET /v1/games`, which returns each game with its per-currency `min_bet`, `max_bet` and `max_win`. Read it rather than hardcoding this table if you display limits — and read it if your enabled set has been narrowed, since it reflects what your account actually has.

If you launch in a currency your account does not have, the refusal is `422 CURRENCY_NOT_SUPPORTED` and its `details.supported` names the currencies you do have. It is never a conversion.

## 7. Reconciliation & reports

When your side times out and you do not know whether a bet applied, `GET /v1/transactions/{transaction_id}` is the authoritative answer. `404 TRANSACTION_NOT_FOUND` means it never reached us — you can safely treat your side as not applied.

| Endpoint | Purpose |
| --- | --- |
| `GET /v1/transactions/{id}` | Single transaction status — the reconciliation escape hatch. |
| `GET /v1/rounds/{id}` | Round detail with its full transaction list and, where supported, a `replay_url`. |
| `GET /v1/reports/transactions` | Paginated ledger export. `from`/`to` required, window ≤ 31 days, cursor pagination. |
| `POST /v1/reports/exports` | Async extract for long ranges (`csv` / `jsonl`); poll until `ready`, download via signed URL. |
| `GET /v1/reports/summary` | GGR / NGR / observed-RTP aggregates, groupable by `game_code` and `currency`. |
| `GET /v1/games` | Games enabled for you, with per-currency `min_bet` / `max_bet` / `max_win` limits. |
| `GET /v1/health` | Unauthenticated liveness for your monitoring. |

## 8. Error envelope & status codes

Every non-2xx response from us carries the same envelope:

```json
{
  "error": {
    "code": "INSUFFICIENT_FUNDS",
    "message": "Player balance is lower than the requested bet amount.",
    "request_id": "01J8Z6...",
    "details": {
      "required": 5000,
      "available": 1200,
      "currency": "EUR"
    }
  }
}
```

Branch on `code`, never on `message` or the HTTP status alone. Quote `request_id` in support tickets — it is the join key across our logs.

| Status | Meaning |
| --- | --- |
| 200 / 201 | Success / resource created (launch). |
| 400 | Malformed request. |
| 401 | Authentication failed (key, signature, timestamp, nonce). |
| 403 | Authenticated but not permitted (IP, disabled game, blocked player). |
| 404 | Resource does not exist. |
| 409 | Idempotency key reused with a different body. |
| 422 | Well-formed but rejected by business rules. |
| 429 | Rate limited — includes `Retry-After`. Headers `X-RateLimit-Limit` / `-Remaining` / `-Reset` on every response. |
| 500 | Internal error. Safe to retry with the SAME idempotency key. |
| 503 | Maintenance — includes `Retry-After`. |

## 9. Validating your integration

Before production keys are issued, your integration has to be demonstrated — not described. There are two halves, and they are judged differently because they fail differently.

| Half | Direction | How we judge it |
| --- | --- | --- |
| **Inbound** | You call us | OBSERVED. Every authenticated sandbox request you make is recorded, and the verdicts are read from what your integration actually did. |
| **Outbound** | We call your wallet | PROBED. Your wallet is a server we can call, so we call it — the sequence in section 5, run against you. |

We cannot run your client code, so no request we make could prove YOUR signing is correct — only you can demonstrate that, by signing something we accept. Your wallet is a server with an address, so it can simply be tested. Neither half substitutes for the other.

### Run the checklist against yourself

This is the same sequence we run before approving an integration, started by you instead of by us — so a green result here is the result we will see, not an approximation of it. Run it, read the failures, fix, run again.

**POST /v1/validation/runs**

```http
POST /v1/validation/runs
X-API-Key: ak_...
X-Timestamp: 1787950000
X-Nonce: 3f2b9c...
X-Signature: sha256=...
Content-Type: application/json

{ "currency": "INR", "game_code": "mines" }
```

Both fields are optional. `currency` must be one of yours — a probe in a currency you do not settle in is refused, because the run would certify a configuration that does not exist. Omit it and your default currency is used. **Which currency you choose decides what the run unlocks** — see *Validating each currency* below.

> **Important:** This makes REAL calls to your wallet: a balance read, a deliberately wrong signature, a bet larger than your balance, a one-minor-unit debit, two rollbacks and a zero win. It puts back everything it takes — net movement zero — against a designated test player named in the response. Limited to one run per minute, answered `429 VALIDATION_COOLDOWN` with `Retry-After`.

Probes are signed with your SANDBOX webhook secret, never the production one — probing a wallet with the key that signs live traffic would hand a test environment a production credential. Without sandbox credentials issued you get `400 VALIDATION_NOT_READY`.

### Reading the result

```json
{
  "run_id": "9c1f...",
  "status": "failed",
  "plan_version": "1.1.0",
  "cases_total": 9,
  "cases_passed": 8,
  "cooldown_seconds": 60,
  "cases": [
    {
      "id": "wallet.insufficient_funds",
      "title": "A bet larger than the balance is refused, and nothing is debited",
      "required": true,
      "verdict": "fail",
      "detail": { "problems": ["the balance moved on a REFUSED bet (1000000 -> -1)"] }
    }
  ]
}
```

- `status` is `passed` only when every REQUIRED case passed. Advisory cases carry a verdict and appear in the list; they do not decide it.
- **`skip` is not a pass.** It means the case could not be answered — almost always because an earlier one failed and left it unanswerable.
- `plan_version` is stored on the run. A result that passed 7 of 7 against an older plan does not read as "passed" against a newer one, because the cases it never saw are exactly the ones we added after learning something. Case ids are stable strings, never ordinals.

### What each case is really asking

| Case | A failure means |
| --- | --- |
| `wallet.reachable` | We could not reach you over TLS inside the timeout, or you redirected. Redirects are never followed and are usually a trailing slash or a proxy misconfiguration. |
| `wallet.verifies_signature` | A request signed with the WRONG secret was accepted. |
| `wallet.balance` | The balance was not an integer of minor units, or the currency differed from the request. |
| `wallet.insufficient_funds` | A bet larger than the balance was accepted — or was refused AND debited anyway. |
| `wallet.bet_dedupe` | A repeated `transaction_id` debited twice, or returned a different `operator_tx_id`. |
| `wallet.rollback_unknown` | A rollback of a transaction you have never seen did not return `200`. |
| `wallet.rollback_repeat` | A second, identical rollback errored. |
| `wallet.zero_win` | A win of `amount: 0` was rejected. |
| `wallet.balance_non_negative` | Some response in the sequence reported a negative balance. |

> **Important:** Three of these are failures your own testing cannot find, because all three make your wallet MORE permissive — so every happy path still works. Not verifying our signature means anyone who learns your callback URL can move balances. Not enforcing funds lets a player stake money they do not have. And a wallet that answers `INSUFFICIENT_FUNDS` while debiting anyway is the quietest of the three: we void the round and send NO rollback, because the contract says nothing was applied — so both sides agree the bet never happened and no reconciliation ever looks for the amount.

### Validating each currency

A passing run certifies the currency it ran in — and every other currency of yours that shares its **exponent**. Until a currency is certified it stays `pending`, and a real-money launch in it is refused with `422 CURRENCY_VALIDATION_REQUIRED`.

The reason is the two arithmetic cases above. `wallet.balance` and `wallet.balance_non_negative` exist to catch a wallet that hardcodes two decimal places, and that fault is a property of the exponent rather than of the code: a wallet that counts EUR correctly counts USD and INR by the same arithmetic, and may still be wrong by ten thousand in USDT and by a million in BTC. Passing in EUR is therefore not evidence about USDT, and we no longer treat it as any.

> **Important:** Code WIDTH is a second axis, and it does not line up with the exponent. `USDT`, `USDC` and `MATIC` are four and five characters; a wallet with a `CHAR(3)` column or a `/^[A-Z]{3}$/` validator rejects or truncates them at any exponent. So a run in a three-letter code does not certify a longer one — but a run in a longer one certifies both. Choosing `USDT` over `XRP` closes exponent 6 in a single run.

| Run this | and these go live |
| --- | --- |
| `EUR` (exp 2) | All 41 two-decimal fiat — USD, INR, BRL, ZAR and the rest. |
| `JPY` (exp 0) | `CLP` `ISK` `JPY` `KRW` `VND` |
| `KWD` (exp 3) | `BHD` `JOD` `KWD` `OMR` `TND` |
| `USDT` (exp 6, wide) | `ADA` `TRX` `USDC` `USDT` `XRP` |
| `MATIC` (exp 8, wide) | `BCH` `BNB` `BTC` `DAI` `DOGE` `ETH` `LTC` `MATIC` `SOL` |

So five runs cover all sixty-five, and you only need the classes you actually settle in — a partner taking EUR, USD and INR needs exactly one. The response names what it unlocked in `activated`, and `422 CURRENCY_VALIDATION_REQUIRED` names what you can already use in `details.validated`.

> **Important:** Nothing already live is affected: every currency enabled before this existed stays live. It applies to currencies added from now on. Sandbox launches, demo mode and transfer-wallet operators are never gated by it — sandbox in particular, because running the probe is how a currency stops being `pending`.

Probing an exponent you have never settled in needs a funded test player in a currency of that class on your side — a crypto one for exponents 6 and 8. Worth arranging before go-live rather than discovering on the call.

### The inbound half needs you to have called us

Nothing is observed until you send real sandbox traffic. Until then every inbound case is `skip` rather than `fail` — you have not failed anything, you have not started. What is read from that traffic:

| Case | Reading a failure |
| --- | --- |
| `auth.accepted` | Nothing else can be judged until signing works at all. |
| `auth.signature_stable` | Signing was right and then broke — almost always the body being re-serialised after it was hashed. |
| `auth.fresh_nonce` | A counter, a constant, or a nonce reused across retries. In production this is intermittent failure under load. |
| `auth.clock` | An unsynchronised clock. It fails a fraction of requests, and the fraction grows silently. |
| `net.whitelist` | Your production egress is usually a different address from the one you tested on. Getting this wrong is a total outage at go-live, not a degradation. |
| `launch.succeeded` | Authenticating is not integrating. This is the first call that does something. |
| `launch.environment_aware` | Repeated attempts to open a real-money session with a sandbox credential — your configuration has one mode for both environments. |
| `errors.handled` | A long run of identical failures with no successes between them. A client that retries a 4xx unchanged turns one misconfiguration into a rate-limit incident. |

### Send us your own report

The last thing before production keys. Once you are green, send us YOUR results as a JSON file — your verdicts, recorded by you, for every case. We compare them against ours case by case, and the integration is not approved until the two agree.

> **Important:** There is no endpoint for this. It is a file you send to your integration contact, who uploads it — deliberately, because the point of the comparison is that your record and ours are produced independently.

**The whole file. Nothing wraps it.**

```json
{
  "plan_version": "1.1.0",
  "results": [
    { "case_id": "auth.accepted",               "verdict": "pass" },
    { "case_id": "auth.signature_stable",       "verdict": "pass" },
    { "case_id": "auth.fresh_nonce",            "verdict": "pass" },
    { "case_id": "auth.clock",                  "verdict": "pass" },
    { "case_id": "net.whitelist",               "verdict": "pass" },
    { "case_id": "launch.succeeded",            "verdict": "pass" },
    { "case_id": "launch.environment_aware",    "verdict": "pass" },
    { "case_id": "errors.handled",              "verdict": "pass" },
    { "case_id": "wallet.reachable",            "verdict": "pass" },
    { "case_id": "wallet.verifies_signature",   "verdict": "pass" },
    { "case_id": "wallet.balance",              "verdict": "pass" },
    { "case_id": "wallet.insufficient_funds",   "verdict": "pass" },
    { "case_id": "wallet.bet_dedupe",           "verdict": "pass" },
    { "case_id": "wallet.rollback_unknown",     "verdict": "pass" },
    { "case_id": "wallet.rollback_repeat",      "verdict": "pass" },
    { "case_id": "wallet.zero_win",             "verdict": "pass" },
    { "case_id": "wallet.balance_non_negative", "verdict": "pass" }
  ],
  "run_id": "9c1f...",
  "note": "anything you want on the record"
}
```

- `results` is required. Each entry needs `case_id` and `verdict`; `verdict` is `pass`, `fail` or `skip`.
- **`case_id`, not `id`.** The run response calls the field `id` and nests the list under `cases` — this file uses `case_id` under `results`. Transform it; do not send the run response back unchanged.
- **All seventeen cases**, both halves. A case we hold a result for and you do not is recorded as "no result", which is not agreement and blocks approval just as a disagreement would.
- `run_id` and `note` are optional and are kept with the submission. Extra fields are fine — we store your document as sent, so nothing you add is a reason for it to be refused.

> **Important:** Send what you actually observed, including failures. The row that matters most to both of us is a case you believe PASSED that we did not see pass — it almost always means you tested against the wrong environment, or a retry swallowed a failure. Copying our verdicts back guarantees agreement and proves nothing, and it is the one thing this comparison exists to catch.

We store the exact bytes you send plus a SHA-256 of them. Months later, "this is what we sent" stays answerable by you as well as by us.

## 10. Go-live checklist

Every wallet line below is asserted by `POST /v1/validation/runs` (section 9), so this is a gate with a verdict per line rather than only a list. Run it until it is green, then we walk the rest together before production keys are issued.

- Verify `X-Signature` on every callback, constant-time compare.
- Reject timestamps older than 60 s; cache nonces for 120 s.
- Dedupe on `transaction_id`; return the ORIGINAL result on a repeat, never an error.
- Apply debit and credit atomically inside one database transaction.
- Return `200` for a rollback of an unknown transaction.
- Return `200` for a rollback of an already-rolled-back transaction.
- Persist rolled-back IDs and reject a late-arriving original bet for them.
- Respond within 3 s at p99.
- Return balances in minor units, in the session currency, exactly.
- Handle `amount: 0` wins without erroring.
- Refuse a bet larger than the balance with `INSUFFICIENT_FUNDS`, and debit NOTHING — we void the round and send no rollback, so anything taken here is money nothing will return.
- Never return a negative balance. It means a debit was applied that should have been refused.
- Pass `POST /v1/validation/runs` with every required case green and no skips.
- Send us your own report — all seventeen cases, your verdicts, in the shape in section 9. Production keys are not issued until it agrees with ours.
- Call `/sessions/launch` from your backend only, with an `Idempotency-Key`, and reuse the key verbatim on retries.
- Reconcile timeouts via `GET /v1/transactions/{id}` rather than guessing.
- Whitelist your PRODUCTION egress addresses — not the ones you tested from.
- Deploy the production `api_key`, `api_secret` and `webhook_secret` TOGETHER. A production key with a sandbox webhook secret authenticates your requests and rejects every callback we make, which reads as a total wallet outage on your first live round.

## 11. After production keys — what actually changes

Section 10 gets you the keys. This section is what changes the moment you hold them. Everything below is a DIFFERENCE between the two environments, which means none of it was exercised by anything you tested — a sandbox integration can be green on all seventeen cases and still fail its first live launch on one of these.

|  | On sandbox | On production |
| --- | --- | --- |
| `mode` | `demo` only, at every account status | `real` and `demo` both |
| `api_key` / `api_secret` | Your sandbox pair | A new pair, issued separately |
| `webhook_secret` | The sandbox secret | A DIFFERENT secret — one per environment |
| API base URL | Sandbox host | Production host |
| Currency gating | Never applied | `CURRENCY_VALIDATION_REQUIRED` on any currency with no passing probe |
| Your requests as evidence | Recorded, and scored by validation runs | Not recorded |

### 1. Switch `mode` to `real` — in your backend, not your lobby

This is the change you came here for, and it is the smallest. What matters is WHERE you make it. Derive `mode` in your backend from the credential it is holding — sandbox implies demo, production implies real — rather than accepting it from the browser. A player-facing client that chooses whether a session moves real money is a client that can be edited to choose wrong, and it is also how this setting quietly regresses the next time the lobby is rebuilt.

### 2. Deploy all three values together

`api_key`, `api_secret` AND `webhook_secret`, in one release. A production key paired with your sandbox webhook secret authenticates your requests perfectly and rejects every callback we make — which presents as a total wallet outage on your first live round, with nothing in your own logs to explain it.

> **Important:** API keys OVERLAP and webhook secrets CUT OVER. Two `api_key`s can be active at once, so you move traffic on your own schedule. There is exactly one webhook secret per environment, because we sign with it — so the production one becomes live the moment it is issued, with no grace window. Agree a moment for it.

### 3. Whitelist your PRODUCTION egress addresses

The addresses your live backend calls us from are usually not the ones you tested from. Anything else is `403 IP_NOT_WHITELISTED`. The whitelist belongs to your ACCOUNT rather than to an environment, so adding production addresses does not remove your sandbox ones — send us both sets and keep them both.

### 4. Register your production lobby origin

The `frame-ancestors` allowlist fails closed, and your production lobby is a different origin from whatever you embedded the game in during integration. Miss this and the launch succeeds, the URL is valid, and the iframe renders blank — see section 4 for the exact form to send.

### 5. `callback_base_url` is ONE field for both environments

> **Important:** The sharp one. Your callback base URL is a property of your ACCOUNT, not of an environment — there is no separate sandbox value. Pointing it at your production wallet points sandbox traffic there too, and pointing it back to test something takes production with it. Plan this change rather than discovering it: if you need both live at once, route by the `mode` field we send you on every callback.

### 6. A refusal you have never seen before

`422 CURRENCY_VALIDATION_REQUIRED` is exempt in sandbox and exempt in demo, by construction — sandbox because the probe is how a currency stops being pending, demo because it never reaches your wallet at all. So your first REAL launch in a currency is the first time this gate can fire. It means the currency is enabled for you but has no passing wallet probe at its exponent; `details.validated` names what you can launch in right now. Run the outbound probe per currency BEFORE go-live, not per account — see section 9.

### 7. Keep your sandbox key

It keeps working after you go live, and it is still the only credential whose traffic is recorded as validation evidence. Production requests are not observed — that is the ledger's job. So anything you need to re-prove later, and any change you want to exercise before it touches real money, runs on the sandbox key in demo exactly as it did during onboarding.
