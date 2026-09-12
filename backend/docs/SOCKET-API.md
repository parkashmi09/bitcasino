# Sockets — the protocol

How to connect, what a frame looks like, and every event with the audience that
may send it.

|  |  |
| --- | ---: |
| Services with a socket server | 4 |
| Registered events | 78 |
| Legacy events ported | 77 / 79 (97.5%) |

This is the **reference**. For what the legacy transport did and what it cost —
the audit that produced most of the decisions below — see
[SOCKETS.md](SOCKETS.md).

**Contents**

1. [Connecting](#1-connecting)
2. [Signing in on an open socket](#2-signing-in-on-an-open-socket)
3. [The wire format](#3-the-wire-format)
4. [Request and reply](#4-request-and-reply)
5. [Audiences](#5-audiences)
6. [Rate limits](#6-rate-limits)
7. [Errors](#7-errors)
8. [Broadcasts](#8-broadcasts)
9. [Every event](#9-every-event)
10. [The two that are not ported](#10-the-two-that-are-not-ported)

---

## 1. Connecting

Four services attach a Socket.io server, each on the same port as its HTTP
routes. A service owns the sockets that touch the things it owns:

| Service | Port | Events | Why there |
| --- | ---: | ---: | --- |
| user | 4001 | 49 | auth, wallet, chat, profile, rakeback, spin, bonus, preferences, moderation |
| casino | 4003 | 25 | a game round is a debit, a result and a payout in one transaction — an HTTP hop inside that would break its atomicity |
| admin | 4002 | 3 | the operator console |
| sports | 4004 | 1 | `SPORT_GAME` needs the feed client, its cache and its credentials |

```js
import { io } from 'socket.io-client';

const socket = io('https://api.example.com', {
  auth: { token: accessToken },      // optional — omit for a signed-out visitor
  withCredentials: true,
});
```

The token may also be passed as `?auth_token=` in the query, which is what
existing clients do.

**A missing token is fine.** It means a signed-out visitor, who may still send
`public` events. Legacy did `if (!token) return;` and dropped the connection
silently, so a signed-out visitor got a socket that accepted nothing and said
nothing.

### Origins

`SOCKET_ALLOWED_ORIGINS` is a comma-separated allowlist and is **always**
enforced. There is no default: an unset value means no browser origin connects,
which fails visibly. Legacy hardcoded eight origins mid-file and then consulted
the list only when `config.developer` was true — so production accepted every
origin.

### Frame size

512 KB at the transport, and the wire layer caps decoded payloads again. Legacy
had no limit on a socket anyone could open.

---

## 2. Signing in on an open socket

A visitor arrives signed out, so the handshake carries no token. They then log
in — over HTTP or over `LOGIN_USER` — and the already-open socket knows nothing
about it. Every `player` event would be refused until they reload the page.

`ONLINE_LOGGED` rebinds the connection:

```js
socket.emit(EVENTS.ONLINE_LOGGED, encode({ token: accessToken }), (reply) => {
  const { status, uid, name } = decode(reply);
});
```

The audience is `public` by necessity — an anonymous connection is exactly who
sends it. What makes it safe is that the **transport** verifies the token, not
the handler: the handler never sees an id it could trust or set. It also leaves
the previous player's room, which legacy did not — a socket that authenticated
as one player and then another kept receiving the first one's private pushes for
as long as it stayed open.

---

## 3. The wire format

Payloads are encoded. `@ibitplay/socket` exports `encode` and `decode`, and both
directions use them:

```js
socket.emit(EVENTS.MY_BETS, encode({ limit: 20 }), (reply) => {
  const data = decode(reply);
});
```

### The event names are opaque hashes, and they are the protocol

```js
EVENTS.SEND_TIP    === "573a867973fa586555cab080e7d837ad"
EVENTS.PLAY_PLINKO === "f31c1e97179a0c766a9da0fdde28d3ed"
```

They were lifted **byte-for-byte** from `legacy/General/Constant/index.js`. One
character different and that event silently stops working for every player: the
server listens on one string, the client sends another, and neither side errors.
It just goes quiet. A test pins the whole table against the legacy file, and
`createSocketServer.on()` refuses to register a name that is not in it — so a
typo fails at boot rather than producing a listener nothing ever triggers.

Several values contain characters no hash function produces
(`…9jxd7hm7`, `…ci73bd3`, `1c21e823212f96113sd7725Q`). They were hand-edited at
some point and are still what the clients send. `PLAT_SLOTS` (not `PLAY_`) and
`inr_History` are inconsistent with everything around them and are correct.

### Two tables

`EVENTS` mirrors the legacy constant file — 157 names.

`LITERAL_EVENTS` holds the ones legacy wrote as string literals in a handler
rather than through that file. Nine were handlers — `wheeler`,
`getBonusTimers`, `identify`, `subscribeUserConfig`, `admin_notify`, the three
console events, and `new_query` — and the table declares eight, since
`new_query` has no ported form. Alongside them are the push-only names a
handler replies *on*: `bonusTimerUpdate`, `userConfigUpdated`,
`siteConfigUpdated`, `usersAllDetails`. Twelve entries in all.

They are just as much the wire protocol as the hashed ones, so they are
declared — but in a **separate** table, so the test pinning `EVENTS`
byte-for-byte against the legacy constant file stays exactly as strict as it is.
A key in `EVENTS` that is not in that file fails the build.

---

## 4. Request and reply

Every event replies. If the client passed an **ack callback**, the reply goes
there; otherwise it is emitted back on the same event name — which is what every
legacy handler did.

```js
// ack — preferred: the reply is attributable to this request
socket.emit(EVENTS.USER_INFO, encode({}), (reply) => { ... });

// or listen on the same event
socket.on(EVENTS.USER_INFO, (frame) => { ... });
socket.emit(EVENTS.USER_INFO, encode({}));
```

Prefer the ack. With ten concurrent requests in flight, listeners cannot tell
which reply belongs to which request.

### The reply shape

```jsonc
{ "status": true,  "...": "the payload" }
{ "status": false, "msg": "human-readable", "error": { "code": "SOCIAL_MUTED" } }
```

`status` rather than `success` — this is the legacy envelope, kept because
shipped clients read it.

**A refusal is answered, never swallowed.** Legacy's `if (!id) return;` dropped
the message; the client waited for a reply that never came and showed a spinner
until it gave up. Every refusal here emits, so a client can tell "you are signed
out" from "the server is slow".

---

## 5. Audiences

A module declares an event with an audience, and the transport attaches the
guard — a handler physically cannot forget its own auth check:

| Audience | Requires | Context |
| --- | --- | --- |
| `public` | nothing | `context.userId` may be null |
| `player` | a verified access token | `context.userId` |
| `staff` | a verified **admin** token **and** a live staff row | `context.staff` |

`staff` checks the row, not just the signature: a staff member disabled at 09:00
keeps a valid eight-hour token until 17:00. On user-service — which does not load
the `admin` model domain — that check goes over
`GET /internal/admin/auth/verify` rather than reaching into another service's
tables.

A player token verifies as `access` and never as `admin`, so it can never
satisfy a `staff` event.

### Why some events are public

Not by omission. A fixture list, a leaderboard and a chat room name no player and
move no money, and a visitor deciding whether to sign up is exactly who reads
them. Legacy had nineteen of forty-two handlers with no check at all; most were
defensible and three were not — `USER_INFO`, `GAME_DETAILS` and `USER_CHART` all
took an id **out of the message**, so any client could read any player's profile,
history and chart. `USER_INFO` returned the balance in every currency.

The difference now is that `public` is a declaration somebody made, not a line
somebody forgot.

---

## 6. Rate limits

Per connection, per event. Legacy metered nothing on this transport — including
login, which made password guessing over the socket unmetered and invisible to
every HTTP rate limiter in front of the service.

| Audience | Default |
| --- | --- |
| `public` | 40 per 10s |
| `player` | 120 per 10s |
| `staff` | 200 per 10s |

Events that cost more override it:

| Event | Limit | Because |
| --- | --- | --- |
| `ADD_CHAT` | 20/min | One client could otherwise flood every connected player |
| `ADD_RAKEBACK` | 10/min | It moves money and takes no payload |
| `ONLINE_LOGGED` | 10/min | A loop here is somebody trying tokens |
| `SPORT_GAME` | 60/min | Each miss is an upstream call to a rate-limited provider |
| `GET_USERS_ALL_DETAILS` | 12/min | Each call runs two heavy queries |

Exceeding one returns `SOCKET_RATE_LIMITED`; the connection stays open.

---

## 7. Errors

```jsonc
{ "status": false, "msg": "Not enough balance",
  "error": { "code": "WALLET_INSUFFICIENT_FUNDS" } }
```

Codes are the same namespaced values the HTTP surface uses — `SOCIAL_MUTED`,
`P2P_ORDER_ALREADY_SETTLED`, `RAKEBACK_NOTHING_TO_CLAIM`. Branch on
`error.code`, never on `msg`.

| Code | Means |
| --- | --- |
| `SOCKET_UNAUTHENTICATED` | This event needs a player or staff credential |
| `SOCKET_RATE_LIMITED` | Too many of this event |
| `SOCKET_HANDLER_FAILED` | Something unexpected. The stack went to our logs, not to you. |

An unexpected throw is caught and answered. Legacy's handlers had no `catch`, so
a throw inside one became an unhandled rejection — which in Node kills the
process, taking every other connected player's socket with it.

---

## 8. Broadcasts

Some events push without being asked:

| Event | Goes to | When |
| --- | --- | --- |
| `ADD_CHAT` | everyone | Somebody posts — **after** the row is written |
| `ADD_MESSAGES` | the recipient's room | A private message arrives |
| `admin_notify` | everyone | An operator broadcasts a notice |
| `WAITING_CRASH` · `STATUS_CRASH` · `BUSTED_CRASH` | everyone | The Crash round changes phase |
| `FINISH_CRASH` | everyone | A player cashes out |
| `bonusTimerUpdate` | the asker | The reply to `getBonusTimers` |
| `userConfigUpdated` | the asker | The reply to `identify` |

**Written first, broadcast second.** Legacy's chat handler called back — which
became `io.emit` to every client — and *then* ran the INSERT, so a failed insert
still reached everyone and the message vanished on the next page load.

A signed-in socket joins `user:<id>`, so a player with two devices gets their
private pushes on both.

`admin_notify` still emits `{mesage: content}` — one `s`. That typo is the wire
protocol; shipped clients read it, so fixing it alone would silence the notice
everywhere. The correct spelling is sent alongside.

### No cross-process adapter

There is no Socket.IO Redis adapter configured, so a broadcast reaches only the
sockets on the emitting process. That is why the four moderation events live on
**user-service's** transport rather than admin-service's: two of them broadcast,
and the player sockets are there.

---

## 9. Every event

### user-service — :4001

**`auth`** — Login, registration, sessions, 2FA. `LOGIN_USER` is `public` by necessity — you cannot require a token to sign in.

| Event | Audience | Wire name |
| --- | --- | --- |
| `LOGIN_USER` | public | `faf9ba208ad90e7313b6ffafde53b801` |
| `LOGIN_USER_GOOGLE` | public | `383f7bf0257c3ef6cab20278dd1579be` |
| `ONLINE` | public | `7f76165777d11ee5836777d85df2cdab` |
| `TWO_FA_CONFIRM` | player | `158231da52345s194323232211136d91b50` |
| `TWO_FA_DISABLE` | player | `1582223323345s19432325311136d91b50` |
| `LOGOUT_USER` | player | `1f7009c5312bab76e660578ecbe08350` |
| `REGISTER_USER` | public | `0a2637735ee07dd5f0e5eba7b9ca1ce7` |
| `RESET_PASSWORD` | public | `62a0b91a9b98a7ec19f27e72c13de207` |
| `EDIT_PASSWORD` | player | `ed7feda03376fd39087183552f093e6a` |
| `ONLINE_LOGGED` | public | `faf9ba208bd90e2313b6faeede53b801` |
| `TWO_FA` | player | `158231da5231e9ab76b2323232136d91b50` |
| `GET_UID` | player | `002b67aa7d872615cc6ef9ffa78c766d` |

**`wallet`** — Tips, rain, balances. Every one moves money.

| Event | Audience | Wire name |
| --- | --- | --- |
| `SEND_TIP` | player | `573a867973fa586555cab080e7d837ad` |
| `RAIN` | player | `23678db5efde9ab76bce8c23a6d91b50` |
| `CREDIT` | player | `660cb6fe7737d7b70e7a07b706b93f70` |
| `CREDIT_COIN` | player | `e70b7663b91b67a7f7e027c00f5a30e2` |
| `WALLET_HISTORY` | player | `c23c59dd3258d3a53d7132652f8bf98a` |

**`social`** — Chat, friends, private messages — and the four moderation events, which are staff-only.

| Event | Audience | Wire name |
| --- | --- | --- |
| `ADD_CHAT` | player | `1e6ccf0ddced017179b173e5cc78beea` |
| `CHATS` | public | `7a7fe97bbc5ff21a561b79986db975c5` |
| `ADD_FRIEND` | player | `265ea6ce905188a0751e8f0273d30bb7` |
| `MY_FRIENDS` | player | `1e73d7d857e371f00a56105a7a38a576` |
| `ADD_MESSAGES` | player | `292d72d37f7e189059f7f998737de9bb` |
| `MESSAGES` | player | `de70938879b75d3db63bba721c93e018` |
| `ADMIN_SET_MUTE` | **staff** | `eca6e08ddde39e22f965270b7d8175d17` |
| `ADMIN_ADD_AVATAR` | **staff** | `15e76a8d237dd050a301d1f33967175a` |
| `ADMIN_ADD_CHAT` | **staff** | `2118e57f1f2bb7979c9a7796d6be671d` |
| `ADMIN_NOTIFY` | **staff** | `admin_notify` |

**`profile`** — Reads, plus `EDIT_ACCOUNT`. The three legacy handlers that took an id from the message are here.

| Event | Audience | Wire name |
| --- | --- | --- |
| `EDIT_ACCOUNT` | player | `ca6e08ddde39ee9f965270b7d8175d17` |
| `USER_INFO` | player | `18566cda79f670c2098360799275aa31` |
| `GAME_DETAILS` | player | `657cdcaf1b9072c7d708bb3766bd3915` |
| `USER_CHART` | player | `1cf37d076d187195c2d7d5e3678dfe0b` |
| `MY_BETS` | player | `fd2a0537bcdae1736f552707b3bd3156` |
| `MY_HISTORY` | player | `fd2a0537bcdae1736f552707b3bd3157` |
| `inr_History` | player | `fd2a0537bcdae1736f552707b3bd3160` |
| `NOTIFICATION` | public | `f37bd2f66651e7d76f6d38770f2bc5dd` |
| `TOP_WINNERS` | public | `b7cafd57089c07ade71b7776085660a0` |
| `LAST_BETS` | public | `62f8c260fbce6de8e5ed19767977cc1e` |
| `LAST_BETS_BY_GAME` | public | `b87a2e8036f0617125ffb69dd5673d7b` |
| `GAMES` | public | `f464cc8e884061eb09553186bdb2e9c1` |
| `BANKROLL` | public | `0c30c5a602062107a5d356d0eb1ebb8e` |

**`crypto-withdraw`** — Withdrawals, swaps and deposit addresses.

| Event | Audience | Wire name |
| --- | --- | --- |
| `SUBMIT_NEW_WITHDRAWL` | player | `7c0b37955cf21c7f2f3773c1268edc08` |
| `SUBMIT_NEW_SWAP` | player | `f2ca6e08d1e7d76f6ddcbcdubci73bd3` |
| `GET_ADDRESS` | player | `396bbdcf7c16c3f3795d932b698ef78f` |

**`rakeback`** — Read the accrual, claim it.

| Event | Audience | Wire name |
| --- | --- | --- |
| `RAKEBACK_AMOUNT` | player | `4d0779dab780d8b773e7h6fl9jxd7hm7` |
| `ADD_RAKEBACK` | player | `k2089ht7ae660578ed9gffgh8hkk7vxj` |

**`spin-wheel`** — The lucky wheel.

| Event | Audience | Wire name |
| --- | --- | --- |
| `WHEELER` | player | `wheeler` |

**`bonus`** — Bonus countdown timers.

| Event | Audience | Wire name |
| --- | --- | --- |
| `GET_BONUS_TIMERS` | player | `getBonusTimers` |

**`preferences`** — Player settings. Both legacy events took the player id from the message.

| Event | Audience | Wire name |
| --- | --- | --- |
| `IDENTIFY` | player | `identify` |
| `SUBSCRIBE_USER_CONFIG` | **staff** | `subscribeUserConfig` |


### casino-service — :4003

**`in-house`** — Twenty in-house games. `PLAY_*` places a bet; the `STATUS_`/`PLAYERS_`/`HISTORY_` events are broadcast state for the shared rounds (Crash, Keno).

| Event | Audience | Wire name |
| --- | --- | --- |
| `PLAY_LIMBO` | player | `18867ffabc768e07378cdaa6df18c75c` |
| `PLAY_CLASSIC_DICE` | player | `05db5c137ef2e883b7087edce72e2560` |
| `PLAY_HASH_DICE` | player | `893295c0a9bc0fe35edf976858c08ba9` |
| `PLAY_DIAMOND` | player | `5eda0ea98752c5a85212a01a960ff77` |
| `PLAY_MAGIC_WHEEL` | player | `5eda0ea98768e9123231667e7f0178` |
| `PLAY_WHEEL` | player | `c8286908aae1ad02a33b83dd9f827921` |
| `PLAY_SINGLE_KENO` | player | `5a828e282af3d79f90ad3b7763052d6e` |
| `PLAY_HIGHLOW` | player | `6ea7f87223223242348c5dd2833b8b2` |
| `PLAY_ROULETTE` | player | `1c21f730837b2f96d129877063d7720B` |
| `PLAY_MINE` | player | `efc657038309b57bd7ce999191a10f51` |
| `PLAY_TOWER` | player | `5eda0ea98752c5a85223231667e7f0178` |
| `PLAY_GOAL` | player | `e2c657038309b57bd7ce999191a10f51` |
| `PLAY_SNAKEANDLADDERS` | player | `e2c657021309b57bd7ce999191a10f51` |
| `PLAY_HILO` | player | `9ce3bafdf91d8deaae771e67bb2b3eea` |
| `PLAY_BLACKJACK` | player | `1c21e830837b2f96d129877063d7725Q` |
| `PLAY_VIDEOPOKER` | player | `1c21f730837b2f96d129877063d7725Q` |
| `PLAY_THREE_CARD_MONTE` | player | `1c21e823212f96113sd7725Q` |
| `PLAY_PLINKO` | player | `f31c1e97179a0c766a9da0fdde28d3ed` |
| `PLAY_CRASH` | player | `05131bff83db9a797b5e9793cfa3bcf6` |
| `STATUS_CRASH` | public | `dcaa9fd7f23aaf0c29f570becf35b76f` |
| `PLAYERS_CRASH` | public | `0fd0a8ecb587292055e1c775d6c39a7e` |
| `HISTORY_CRASH` | public | `d9fe15b677f93abce07076807291e2d6` |
| `FINISH_CRASH` | public | `97c73db9a306213ac2b5c3bdecd20e75` |
| `PLAY_KENO` | player | `a68791c6937532f98fa1be087171f1cc` |
| `STATUS_KENO` | public | `d57cd08cb7980bfea9552583d35bbcb6` |


### admin-service — :4002

**`lords`** — The operator console.

| Event | Audience | Wire name |
| --- | --- | --- |
| `GET_ADMIN_PROFILE` | **staff** | `getAdminProfile` |
| `GET_USERS_ALL_DETAILS` | **staff** | `getUsersAllDetails` |
| `STOP_USERS_ALL_DETAILS` | **staff** | `stopUsersAllDetails` |


### sports-service — :4004

**`feed`** — Live fixtures.

| Event | Audience | Wire name |
| --- | --- | --- |
| `SPORT_GAME` | public | `1c21f3308372251321e3ed7063e7726D` |


---

## 10. The two that are not ported

### `new_query` — permanently

```js
client.on('new_query', (data) => {
  let { query, privates } = data;
  if (!privates) return;
  Rule.runQuery(query, (result) => client.emit('new_query', result));
});
```

Arbitrary SQL, executed and returned, authorised by a boolean the caller puts in
their own message. Sending `{privates: true, query: "..."}` satisfies it.

It is the socket twin of `POST /pedramx`, and `Admin.runQuery` — the function
behind both — is what `legacy-hotfix/` disabled on the live box. There is no
version of this that is safe and no operation it enabled that a named endpoint
cannot do. No replacement, no gateway rewrite: a client calling it gets nothing,
rather than a redirect implying the capability moved. A test asserts it is not
registered and not even in the event table.

The same `if (!privates) return;` was the entire authorisation on all five
handlers in that namespace. The other four are legitimate operator actions and
were ported behind `staff` — see `social` above.

### `C.PLAT_SLOTS` — blocked on a provider

`legacy/Slots/` is a **transfer-wallet** aggregator, which is a different money
model from every integration ported so far. The seamless ones — GIS, XGaming,
nexus — leave the balance here and let the provider call us. This one moves the
balance *to* the provider:

```js
Evo.deposit(user_id, usd, "USD", () => {
  Evo.getLink(user_id, game, (link) => { ... })
})
```

`Rule.preparePlay` reads the player's whole coin balance, converts it to USD and
deposits that into the Evo wallet — **without debiting the local balance**. The
same money is then in both places. Whether that is a real duplication or is
reconciled by a callback this port has not seen is exactly the question that
needs the provider's documentation, and answering it wrong in either direction
moves real money.

Three more things for whoever picks it up:

- `TOKEN = "fb216c4fead6630de2551643267d5ab0"` with `PID = 3064`, hardcoded.
  In `tools/check-secrets.js` and [ROTATION.md](ROTATION.md) §9.
- `CALLBACK = "http://api-transfer-wallet.8provider.com/callback_handler"` —
  plain HTTP, for a callback that moves money.
- `makeExpired()` builds `` `2021-${m}-${d}` `` — the year is a literal, so every
  expiry this integration has issued since 2021 is in the past.

Every error path in `preparePlay` is a bare `return` with no callback, so the
client waits on a reply that never comes.

---

## Regenerating the coverage

```bash
npm run verify:sockets          # 77 / 79 (97.5%)
npm run verify:sockets -- --list  # every event, ported or not
```

It resolves `C.*` constants against `legacy/General/Constant/index.js` and reads
the `@legacy SOCKET <wire-name>` tags in the ported source, so the number is
counted rather than estimated. It also writes `docs/socket-manifest.json`.
