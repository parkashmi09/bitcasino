# The Socket.io surface

`npm run verify:routes` reports **523 / 577 HTTP routes**. That number is
HTTP-only and always was. This document is the other half.

```
npm run verify:sockets   →  79 legacy socket events, 0 ported (0.0%)
```

Socket.io is where most of the player-facing platform lives: login,
registration, chat, tipping, rain, the wallet, swaps, withdrawals and all
twenty-seven in-house game events are socket events, not routes. Quoting 90% without
saying so would misrepresent the state of the port, so `tools/socket-inventory.js`
counts this surface the same way routes are counted — by a `@legacy SOCKET
<event>` tag in the ported code, which cannot be faked by editing a document.

**Nothing on this surface is ported yet.** What follows is the audit.

---

## 1. The admin namespace runs arbitrary SQL, unauthenticated

This is the most serious finding in the entire port.

`legacy/index.js`:

```js
const admin = io.of("/pedramx");
admin.use((socket, next) => {
  next();                      // ← an auth middleware that authenticates nothing
});
admin.on("connection", onPrivateConnection);
```

`onPrivateConnection` is `Admin(client, io)`. `legacy/Admin/index.js`:

```js
client.on('new_query', (data) => {
    let { query, privates } = data;
    if (!privates) return;
    Rule.runQuery(query, (result) => {
        client.emit('new_query', result);
    })
});
```

and `legacy/Admin/Rule.js`:

```js
Admin.runQuery = function (query, callback) {
    Model.query(query, function (error, result) {
        callback({ error, result });
    })
}
```

The only check is `if (!privates) return` — and `privates` is **a field in the
message the attacker sends**. The authorisation test is whether the attacker's
own JSON contains a truthy `privates` key.

```
socket = io('https://<host>/pedramx')
socket.emit('new_query', { privates: true, query: 'SELECT id, password, password2 FROM users' })
```

Arbitrary SQL as the database owner, with the result returned on the socket.
Every password hash, every `password2` cleartext, every balance — readable, and
writable. `DROP TABLE` included.

The same `if (!privates)` pattern guards the other four admin events
(`admin_notify`, `ADMIN_SET_MUTE`, `ADMIN_ADD_CHAT`, `ADMIN_ADD_AVATAR`), so a
platform-wide notification to every connected client is one message.

**This needs to be closed before anything else in this document.** The namespace
should be removed outright — there is no version of it worth keeping, and the
port has no plans to reproduce it.

### The one authenticated socket is never mounted

`legacy/system/sockets/adminPanelSocket.js` does it properly: JWT verified
against `process.env.JWT_SECRET`, staff row loaded from the database, `next(new
Error(...))` on failure. It is required by nothing:

```
$ grep -rn "adminPanelSocket" --include="*.js" legacy/
legacy/system/sockets/adminPanelSocket.js:1:// system/sockets/adminPanelSocket.js
```

So the good namespace is dead code and the ungated one is live. (Its own gap,
for when it is ported: the middleware selects `s.id, s.role_id, r.level` and
never checks `s.status`, so a suspended staff member keeps their socket until
the JWT expires.)

---

## 2. `house` decides whether a player is allowed to win

**I got this wrong earlier and am correcting it here.**

When the casino HTTP routes were ported I wrote, in the module header and in
the batch report, that nothing reads the `house` table to settle anything and
that it is "a display fixture". That was based on grepping `legacy/index.js`
for `FROM house`, which finds only the cron job and the six routes. It is not
where the read is. Following `Users/Rule.js` — which is what surfaced this —
gives the actual chain:

```
Games/ClassicDice/index.js:89   Rule.checkLimited(self.id, coin, (status) => {
Games/Rule.js:329               → Agent.canProfit(id, coin, cb)
Games/Agent.js:93               → UserRule.checkMaxProfit(id, cb)
Users/Rule.js:2314              → SELECT * FROM house WHERE uid = $1
                                  callback(current < max)
```

and `status` is passed straight into the result generator:

```js
let randomResult = Result.make(status, self.data);
```

`Games/ClassicDice/Result.js`:

```js
Result.make = function (canProfit, data) {
  ...
  } else {                                     // canProfit === false
    let type = data.type;
    let roll = data.chance;

    hash = makeHash();
    result = makeResult(hash);

    if (type === "Under") {
      if (result < roll) {                     // the player WOULD have won
        let res = roll + 1 + "." + H.getRandomBetween(10, 98);
        return { hash, result: parseFloat(res) };     // forced to a loss
      }
    } else {
      if (result > roll) {                     // the player WOULD have won
        let res = roll - 1 + "." + H.getRandomBetween(10, 98);
        return { hash, result: parseFloat(res) };     // forced to a loss
      }
    }
  }
```

When `current >= max` on that player's `house` row, a winning roll is discarded
and replaced with a number one step the wrong side of their target. The player
cannot win, and the losing number is not derived from any hash — it is
`roll ± 1` with two random decimal places bolted on as a string.

**The `hash` returned is the hash of the DISCARDED roll.** So the hash the
player is shown does not correspond to the result they were given. Anyone
verifying it would find it does not check out.

`Rule.checkLimited` is consulted by **sixteen games**: ClassicDice, HashDice,
Diamond, Tower, ThreeCardMonte, Wheel, VideoPoker, MagicWheel, HighLow, Mine,
Limbo, SnakeAndLadders, SingleKeno, Goal, Hilo and Roulette.

### Which makes the two unauthenticated GET routes much worse than I said

```js
server.get('/win-house', async (req, res) => {
  await pg.query('UPDATE house SET max = 0, current = 0');     // no WHERE
```

`max = 0, current = 0` makes `current < max` false for **every player on the
platform**. That is the switch, set globally, by an unauthenticated GET — and
the route is named for who wins. `/reset-house` (`max = 50, current = 0`) turns
it back on.

I reported those two as writes to a display table. They are the house edge, and
anyone who could reach the port could set them.

### What the port should do about it

Nothing in the ported services reproduces this, because no in-house game is
ported yet. When they are, the decision is the operator's to make explicitly
and in the open — a declared RTP or max-profit-per-player rule, applied to
whether a bet is ACCEPTED, not by rewriting a result after the fact and
publishing a hash for a different roll. That distinction is the whole
difference between a house edge and a rigged game.

---

## 3. The origin allowlist only runs in development

```js
if (config.developer) {
  if (!domain.includes(origin)) {
    Notify.send("ORIGIN => " + origin + " - Details : " + ip);
    return console.log("origin");
  }
}
```

The check is *inside* `if (config.developer)`. In production the branch is
skipped and any origin connects. This is backwards from every other
configuration in the codebase, and it is the only origin control on the public
namespace.

`Notify.send` is also a no-op — `legacy/Users/Notify.js` is
`Notify.send = function (data) { return };` — so every notification this
codebase believes it is sending goes nowhere. That is worth knowing wherever
`Notify.send` appears to be an alerting path; it is not one.

---

## 4. Any client can subscribe to any player's config

`legacy/siteconfig/sockets/configSocket.js`:

```js
socket.on("identify", async (raw, ack) => {
  const uid = Number(raw);
  ...
  socket.userid = uid;
  socket.join(ROOM.u(uid));
  const cfg = await userModel.get(uid);
  socket.emit("userConfigUpdated", cfg);
});

/* optional: allow re-subscribing to another uid (admin preview) */
socket.on('subscribeUserConfig', id => socket.join(ROOM.u(id)));
```

The client *tells the server who it is*. There is no token in either handler.
The second one does not even pretend — its comment says "admin preview" and it
joins any user's room for anyone who asks.

### And it is registered once per connection

`legacy/index.js` calls `setupSiteConfigSocket(io)` **inside**
`onPublicConnection`, and that function calls `io.on('connection', …)`. So
connection #2 registers a second global connection listener, #3 a third, and
connection number N fires N handlers — each one running two queries and
emitting two payloads. A busy evening is a quadratic amount of work and an
`EventEmitter` leak warning nobody connected to the cause.

---

## 5. `uid` is module-scope state shared by every connection

```js
let uid = "";                            // one variable, whole process
...
Token.getID(token, (id) => {
  if (id) {
    uid = id.toString();                 // last connection wins
    client.userid = id;
```

`client.userid` is per-socket and correct. `uid` is not — it is a single
variable in the enclosing scope that every connection overwrites. Anything
reading `uid` rather than `client.userid` is reading whoever connected most
recently.

---

## 6. Session tokens

- The token is a JWT signed with the string `"keyboardca4ever"`, committed in
  `legacy/Users/Rule.js` — already on the rotation list, and it mints a session
  for any player id.
- `Token.refresh` (the logout path) generates its replacement with
  `H.randomString(25)`, which is `Math.random()` over a 35-character alphabet.
- **Logout does not end the session.** `C.LOGOUT_USER` calls `Token.refresh`,
  which replaces the row in `tokens`. The JWT is valid for `expiresIn: 129600`
  — 36 hours — regardless. The socket path re-checks `tokens`, so logout works
  *there*; anything verifying the JWT directly does not see it.
- `Token.getID` opens with

  ```js
  if (!token && _.isNull(token) && _.isUndefined(token))
  ```

  `&&`, not `||`. A value cannot be both null and undefined, so the guard never
  fires. Not exploitable — `WHERE key = NULL` matches nothing — but it is dead
  code standing where a check is supposed to be, and the same line appears in
  `getToken`.

---

## 7. Nineteen of forty-two handlers have no auth check

**A correction.** An earlier section of this document said `C.CHATS` and
`C.GAMES` were the two handlers that omitted `if (!id) return;`. Counted
properly across `Users/index.js`:

```
handlers: 42   guarded: 23   UNGUARDED: 19
```

Most of the nineteen are fine. Six are pre-login by nature (`LOGIN_USER`,
`REGISTER_USER`, `RESET_PASSWORD`, `LOGIN_USER_GOOGLE`, `ONLINE`,
`ONLINE_LOGGED`) and seven read public data (`GAMES`, `CHATS`, `NOTIFICATION`,
`TOP_WINNERS`, `LAST_BETS`, `LAST_BETS_BY_GAME`, `BANKROLL`). Two are guarded
by accident: `inr_History` and `ADD_MESSAGES` use the connection's `id`, which
is null when signed out, and their callees no-op on it.

**Three are not fine**, and they are the reason this section exists:

```js
client.on(C.USER_INFO, (data) => {
  let { id, coin, first, rate } = decode(data);      // ← shadows the connection's id
  ...
  Rule.userInfo(id, coin, first, rate, (result) => {

client.on(C.GAME_DETAILS, (data) => {
  let { id } = decode(data);
  Rule.gameDetails(id, ...)

client.on(C.USER_CHART, (data) => {
  let { id, game, coin } = decode(data);
  Rule.userChart(id, game, coin, ...)
```

All three destructure `id` **out of the message**, shadowing the connection's
own `id`, and none has a guard. Any client — signed in or not — can read any
player's profile, their game history and their betting chart by sending an id.
`USER_INFO` returns the full balance set across every currency.

This is the same shape as the HTTP findings (`user_id` from the body on bet
placement, `x-staff-id` from a header on the deposit report) on a transport
where it was easier to miss, because the guard is a line you remember to type
rather than something the router attaches.

The port takes the player from the token for all three.

---

## 8. The money rules behind the socket events

`legacy/Users/Rule.js` is 5,517 lines and 95 exported functions. The
balance primitives every game and every transfer goes through:

```js
Rule.reduceBalance = function (id, amount, coin, callback) {
  if (!id && !amount && !coin) return;
  coin = _.lowerCase(coin);
  pg.query(`UPDATE credits SET ${coin} = ${coin} - $2 WHERE uid = $1 RETURNING ${coin}`, …)
```

Three things:

- **No floor.** No `WHERE ${coin} >= $2`. Balances go negative, and the "do they
  have enough" check is a separate unlocked read in the caller.
- **The column name is interpolated** from `coin`. `_.lowerCase` is a *formatting*
  function, not a sanitiser — it converts punctuation to spaces, so
  `"inr = 9, usdt"` becomes `"inr 9 usdt"` and produces a syntax error rather
  than an injection. It blocks this by accident. It is not a guard, and it also
  mangles any legitimate identifier containing a digit or underscore.
- **`&&` again.** `if (!id && !amount && !coin) return` only returns when all
  three are falsy, so `reduceBalance(undefined, 100, 'inr')` proceeds with
  `id = NaN`.

`Rule.makeRain` builds a table name the same way: `"chat_" + _.lowerCase(room)`,
with `room` from the socket message.

The ported services already do all of this correctly for the HTTP surface —
guarded UPDATEs whose row count is the answer, exact minor units, enumerated
coin columns. When the socket surface is ported it should route through the
same `wallet.repository.js`, not reimplement it.

---

## What porting this looks like

The 79 events split into four groups, and they are not equally hard:

| | Events | Notes |
|---|---:|---|
| In-house games | 27 | crash, dice, keno, mines, plinko, blackjack, roulette, … |
| Reads | 22 | history, bets, winners, charts, notifications |
| Wallet & social | 14 | credit, tip, rain, swap, withdrawal, chat, friends |
| Auth & account | 12 | login, register, 2FA, password, edit account |
| Admin (`/pedramx`) | 4 | **delete rather than port** |

(Counted from `docs/socket-manifest.json`, not by eye — `admin_notify` is the
fifth handler on that namespace but shares a name with the event it emits.)

The reads are mostly mechanical and several already have HTTP equivalents in the
ported services. The games are the real work: each carries its own provably-fair
seed handling and its own settlement path.

The wire names are obfuscated hashes (`C.SEND_TIP` is
`"573a867973fa586555cab080e7d837ad"`), so any port has to keep the constant
table exactly — `legacy/General/Constant/index.js` — or every existing client
breaks. `tools/socket-inventory.js` resolves the constants, which is why the
inventory reports the hashes a client actually sends rather than the names the
source uses.

---

## 9. Where it ended up

**77 of 79 ported (97.5%).** The audit above described the surface; this
records what happened to it. Numbers from `npm run verify:sockets`, which
resolves the constant table rather than counting by eye.

Three services now hold a Socket.io server, because a service owns the sockets
that touch the things it owns:

| Service | Events | Why there |
|---|---:|---|
| user | 66 | auth, wallet, chat, profile, rakeback, spin, bonus, preferences |
| casino | 7 | a game round is a debit, a result and a payout in one transaction |
| sports | 1 | `C.SPORT_GAME` needs the feed client, its cache and its credentials |

### The two that are not ported

**`new_query` — deliberately, permanently not ported.**

```js
client.on('new_query', (data) => {
  let { query, privates } = data;
  if (!privates) return;
  Rule.runQuery(query, (result) => client.emit('new_query', result));
});
```

Arbitrary SQL, executed and returned, authorised by a boolean the caller puts
in their own message. It is the socket twin of `POST /pedramx`, and
`Admin.runQuery` — the function behind both — is what `legacy-hotfix/` disabled
on the live box. There is no version of this that is safe and no operation it
enabled that a named endpoint cannot do. No replacement, no gateway rewrite: a
client calling it gets nothing, rather than a redirect implying the capability
moved. A test asserts it is not registered and not even in the event table.

**`C.PLAT_SLOTS` — blocked on a provider, not on a decision.**

`legacy/Slots/` is a *transfer-wallet* aggregator (8provider / Evo), which is a
different money model from every integration ported so far. The seamless ones —
GIS, XGaming, nexus — leave the balance here and let the provider call us. This
one moves the balance *to* the provider:

```js
Evo.deposit(user_id, usd, "USD", () => {
  Evo.getLink(user_id, game, (link) => { ... })
})
```

`Rule.preparePlay` reads the player's whole coin balance, converts it to USD,
and deposits that into the Evo wallet — **without debiting the local balance**.
The same money is then in both places. Whether that is a real duplication or is
reconciled by a callback this port has not seen is exactly the question that
needs the provider's documentation to answer, and answering it wrong in either
direction moves real money.

Three more things about that file, for whoever picks it up:

- `TOKEN = "fb216c4fead6630de2551643267d5ab0"` with `PID = 3064`, hardcoded.
  Added to `tools/check-secrets.js` and `docs/ROTATION.md`.
- `CALLBACK = "http://api-transfer-wallet.8provider.com/callback_handler"` —
  plain HTTP, for a callback that moves money.
- `makeExpired()` builds `` `2021-${m}-${d}` `` — the year is a literal. Every
  expiry this integration has produced since 2021 is in the past.

Every other error path in `preparePlay` is a bare `return` with no callback, so
the client waits on a reply that never comes.

### What changed on the way

Findings from this section that turned out to be defects in the port itself,
fixed while closing it:

- **`SOCKET_ALLOWED_ORIGINS` was read by three transports and declared in
  none.** `loadEnv` parses `process.env` through a zod object, which strips
  keys the shape does not name — so the value never reached the config, every
  allowlist was empty, and no browser could connect to any socket. Declared in
  `httpEnvShape`, and `parseOrigins` now accepts the array `coercers.list`
  produces as well as a raw string.
- **`bonus_history` and `bonushistory` are two different tables**, one letter
  apart, and only the second had a model — which is why `getUserBonusTimers`
  was raw SQL. `BonusHistoryEngine` covers the first. It cannot be called
  `BonusHistory`: on a case-insensitive filesystem that is the same file as
  `Bonushistory.js`.
- **The rate-limit bucket key was computed in three places** — the per-event
  check, the mid-session re-bind, and the disconnect cleanup. Two of those are
  cleanup, and a cleanup that computes the key differently forgets the wrong
  bucket and leaks the right one. One `bucketKey()` now.

### Three additions the transport needed

- **`AUDIENCE.STAFF`**, satisfied only by `context.staff`, which only the
  transport sets and only from a verified `ADMIN` token *plus* a live staff
  row. A token proves who signed in; it does not prove they are still allowed
  to be here, and tokens last eight hours.
- **`context.bind(token)`** — a socket that opened signed-out and then logged
  in. `C.ONLINE_LOGGED` is what legacy called this, and it reassigned the
  connection's id from the message without leaving the previous player's room.
- **`LITERAL_EVENTS`** — nine events were string literals in a handler rather
  than entries in `General/Constant`. They are just as much the wire protocol,
  so they are declared; separately, so the test pinning `EVENTS` byte-for-byte
  against legacy stays exactly as strict as it is.

### The four `/pedramx` handlers that were worth keeping

§1 called for deleting the admin namespace. Four of its five handlers are
legitimate operator actions and were ported behind `AUDIENCE.STAFF`; only
`new_query` is gone. They live on **user-service's** transport rather than
admin-service's, because two of them broadcast and the player sockets are
there — with no Socket.IO cross-process adapter configured, an emit from
another process reaches nobody. user-service resolves the staff identity
through `GET /internal/admin/auth/verify`.

`admin_notify` still emits `{mesage: content}` — one `s`. That typo is the wire
protocol; shipped clients read it, so fixing it alone would silence the notice
on every existing client. The correct spelling is sent alongside it.
