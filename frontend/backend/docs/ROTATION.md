# Credential rotation

Every secret below is **committed in `legacy/`**. That means it is in the git
history, in every clone anyone has ever made, and in every backup of this
repository. Removing it from the working tree does not un-leak it — each one has
to be changed at the system that issued it.

`npm run verify:secrets` fails the build if any of them reappears in the ported
services. It cannot tell whether they have been rotated; only you can.

Ordered by what an attacker gets, not by effort.

---

## 1. The player JWT secret — `"keyboardca4ever"`

```js
// legacy/Users/Rule.js
let token = jwt.sign({ id: user_id, username: result.name }, "keyboardca4ever", { expiresIn: 129600 });
```

**Anyone holding this repository can mint a session token for any player id.**
No password, no 2FA — the 2FA gate hands out a token before the code is checked
anyway (see `docs/SOCKETS.md`).

**Rotate:** set `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` to fresh random
values (32+ bytes). The ported `TokenService` refuses to construct without them,
so there is no fallback to fall back to.

**Consequence:** every existing session ends. That is the point — you cannot
know which sessions were minted with the leaked key. Schedule it, tell support.

---

## 2. Every staff password

Not a secret with a name — a class of them.

- Staff passwords were **logged in cleartext** on line 2 of the login handler.
- They were **stored in cleartext** in `staff.password2` until migration 029.
- `POST /lords/user-setting/update-password` wrote the cleartext for staff *and*
  players.

Anyone with log access, a database read, or a backup has them.

**Rotate:** force a password change for every staff account. Migration 029 has
already cleared the column, so the only remaining copies are in logs and old
backups — which is exactly why the passwords themselves must change.

---

## 3. The Firebase service-account key

Committed as `bitcoinjito-e3078-firebase-adminsdk-*.json`.

Grants push to **every device the project knows about** and read access to the
project's data. Combined with `GET /firebase/allToken`, which returned every FCM
token to anyone who asked, an attacker had both the credential and the audience.

**Rotate:** delete the service account in the Google Cloud console and issue a
new key. Do not just rotate the key — the account id is compromised too.

---

## 4. `SECREATEkEYCASINO` — `'Hja934U1nz'`

The XGaming / GamingHub360 callback signature.

On its own it signs a callback. Combined with the fact that **the signature does
not cover the payload** (`sha1(command + timestamp + SECRET)`), it is a
credential for arbitrary balance writes. The port fixes the signature scheme; it
cannot fix the leaked key.

**Rotate:** with the provider. Then set `XCASINO_SECRET`, and turn
`XCASINO_ALLOW_LEGACY_HASH` **off** once they sign the body.

---

## 5. The nexus aggregator credentials

```js
agent_code:  "Skyla_USD",
agent_token: "83eb5e7c8f7a1852f61692442a5ead9c",
```

In three handlers. This is the account the platform plays through — the same
credential `/game_launch` uses to open **real-money** sessions.

**Rotate:** with nexusggreu. Set `CASINO_NEXUS_AGENT` and `CASINO_NEXUS_TOKEN`;
there is deliberately no default, so a missing value fails loudly rather than
playing through the old account.

---

## 6. CCPayment — app id and secret

```js
const appId     = "mvEYJASPV187Zjxu";
const appSecret = "48e60e26e298f7bb6023209f9c48b91c";
```

Signs deposit webhooks. Anyone with this repository can sign a deposit.

**Rotate:** in the CCPayment dashboard. Set `CCPAYMENT_APP_ID` and
`CCPAYMENT_APP_SECRET`.

---

## 7. The support mailbox — `support@camelbit.games` / `camelbit@123`

Hardcoded in the nodemailer transport. Password-reset mail originates from it,
so control of the mailbox is control of every account that can be reset through
it.

**Rotate:** change the mailbox password and move it to `SMTP_PASSWORD`.

---

## 8. Slotegrator — two merchant accounts

Same vendor, two accounts, both hard-coded:

| Account | Where | Merchant id |
| --- | --- | --- |
| Casino | `legacy/gis/controller.js` | `9088a8210aa9be9c224e9ae5efdc9976` |
| Sportsbook (staging) | `legacy/sportsbook/controller.js` | `856e1604085918d11aa5663ebd546bf7` |

The casino key is the more urgent of the two: it signs our outbound calls **and
verifies their wallet callbacks to us**, so it is both an outbound credential
and the thing standing between an attacker and a forged balance credit.

The sportsbook pair points at `gis-betting-stage.stgr.pw` — staging, consistent
with that module never having been mounted. The account is still real.

**Rotate:** with Slotegrator, both accounts. Set `GIS_MERCHANT_ID` /
`GIS_MERCHANT_KEY` and `SPORTSBOOK_MERCHANT_ID` / `SPORTSBOOK_MERCHANT_KEY`.
Neither has a default — an unconfigured integration refuses rather than signing
with `undefined`, which would produce a stable, guessable signature.

---

## 9. Evo / 8provider — the transfer wallet

```js
// legacy/Slots/API/evo.js
const PID      = 3064;
const TOKEN    = "fb216c4fead6630de2551643267d5ab0";
const CALLBACK = "http://api-transfer-wallet.8provider.com/callback_handler";
```

The account the slots aggregator plays through. Two things make it worse than a
plain leaked token:

- the callback URL is **plain HTTP**, so the responses that move money travel
  unencrypted and unauthenticated on the wire;
- `makeExpired()` builds `` `2021-${m}-${d}` `` with the year as a literal, so
  every expiry this integration has issued since 2021 is already in the past.

**Rotate:** with 8provider, and ask for an HTTPS callback endpoint at the same
time. `C.PLAT_SLOTS` is not ported (see `docs/SOCKETS.md` §9), so nothing in
this repository uses these values — but the account is live.

---

## 10. The rest

| Secret | Where | Opens |
| --- | --- | --- |
| `KjEukDNWN6hH3hTLUHSQZm` | `legacy/index.js` `SECRET_KEY` | Seamless wallet callbacks |
| `f51e33b6-9c24-42b2-98d2-954fc765f78d` | EkQR | UPI deposit callbacks |
| WayPay / A-Pay / CricPay keys | `legacy/.env` | Payment gateways |
| Slotegrator, jsGames v1/v2 | `legacy/index.js` | Casino aggregators |
| `bit_wyusjkwiyu` | `legacy/.env` | Database user |

---

## After rotating

```sh
npm run verify:secrets     # fails if a leaked value is back in the services
```

And consider the history itself. Rotation makes the leaked values worthless,
which is the goal — but if this repository is ever published, `git filter-repo`
on `legacy/` is the follow-up. Rotate first; a scrubbed history containing live
credentials is worse than an honest one containing dead ones.
