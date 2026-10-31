---
name: live-qa
description: Run real-life scenarios on this site through Chrome DevTools (CDP) — the site admin and the player site, both talking to the API they are configured for (the shared apitest API or the site's own local backend) — e.g. sign up a player, manual INR deposit, admin approve with the transaction password, first-deposit bonus ON/OFF, wallet / bonus / VIP screens, balance sheet, game ratio. Use when the user says "real life scenario", "CDP se test kar", "admin se approve karke dekh", "bonus on/off karke check kar", or when an approval asks for TXN_PASSWORD.
---

# Live QA through CDP

## Where

- **Admin:** this site's local admin, `http://localhost:3090`. Override with `ADMIN_URL` (or `--admin <url>` on the script) when testing another deployment.
- **Player site:** this site's local frontend (its port is in `frontend/package.json` / the vite or next config).
- **API:** whatever the admin's `API_URL` and the frontend's API env point to. Check it before any write: a write on a shared API (apitest) is seen by every site on it.
- Open local apps as `localhost:<port>`, not `127.0.0.1`.

## Credentials

- **Where they are:** the site's own git-ignored local notes (e.g. `CREDENTIALS.local.md`, or the site's env skill when it has one). Read them at run time; prefer a login helper that reads them itself.
- **Never** copy a password into this skill, a commit, a report, a log or a screenshot name, and never print it.
- **Transaction password:** the signed-in staff's. The admin asks for it on:
  - deposit approve
  - withdrawal decide
  - wallet adjust
  - points settle
  - money and config saves
- **Error codes:**
  - `TXN_PASSWORD_REQUIRED`: the password was left blank.
  - `TXN_PASSWORD_INVALID`: the password is wrong.
  - `TXN_PASSWORD_NOT_SET`: the staff account has none set. Set it under the admin's My account, then retry. A set transaction password cannot be changed; a superior's password reset issues a new one at the next sign-in.

## Browser rules

- Start with `list_pages`. Never take over the user's own tabs.
- For a new player, open a NEW isolated context.
- For the admin, open one new background page in the already signed-in admin context.
- Keep at most one extra tab per signed-in context. Two tabs rotate the same refresh token and sign each other out.
- Screenshots go in `logs/qa/<scenario>/`.

## Money rules (the test betting budget is the hard limit)

- **Deposits:** a manual deposit is a bookkeeping credit, not provider money. Keep it to the smallest amount the check needs (e.g. just over the first-deposit tier's minimum).
- **Bets:**
  - Third-party games: ₹10 a round, ₹20 per session in total. In-house games: ₹10 or 1 USDT.
  - Sports bets above the budget are skipped and recorded as a finding.
  - So **VIP levels cannot be raised this way.** Raise them on a local backend with seeded wagers instead, and say so in the report.
- **Config changes** (e.g. the first-deposit bonus switch, game ratios):
  - Read the current value first and keep it.
  - Change it through the admin's own requests (the `/api/gw/...` proxy of a signed-in admin tab), with the transaction password when asked.
  - Restore it exactly in the same run, even if a later step fails (`try … finally`).
- **Cleanup:**
  - Test players keep what they were credited.
  - List each one (username, id, balance) in the report, so the owner can lock or reclaim it.

## Scenario: first-deposit bonus ON vs OFF

1. Admin → Site config → Welcome bonuses: note the current state.
2. **OFF:**
   - Switch the first-deposit bonus OFF and save (transaction password).
   - Sign up player A. Deposit just over the tier minimum in INR (manual), then approve it in admin → Manual deposits (transaction password).
   - Expect: the wallet has the deposit, no bonus credit, `/user/bonus/first-deposit` shows `enabled:false`, and the deposit dialog shows no offer.
3. **ON:**
   - Switch it back ON with the tiers.
   - Sign up player B. The deposit dialog shows the offer. Deposit the same amount and approve it.
   - Expect a bonus at the tier rate:
     - straight to the wallet when the wagering multiplier is blank;
     - locked in Bonus Balance when a multiplier is set.
   - It shows in Transaction history, the rollover target and the admin balance sheet ("All (in USDT)", reconciled).
4. Restore the original welcome-bonus config.

## Automating it

Run each admin step with `evaluate_script` on ONE new background admin page (`/site-config/welcome-bonuses`). It calls the admin's own proxy `/api/gw/api/v1/…`, which carries the staff session. Take the transaction password from the local credentials at run time.

1. `GET admin/site-config/welcome-bonuses` and keep the result as the original.
2. In ONE script with `try … finally`:
   - `PUT admin/site-config/welcome-bonuses` with the same body but `firstDepositBonus.enabled: false`.
     - Body: `{ registerBonus: { enabled, amount }, firstDepositBonus: { enabled, tiers: [{ minDeposit, percent, maxBonus }], wagerMultiplier, expiryDays } }`.
   - `PUT admin/user/deposits/fiat/<id>/approve` with `{}`. Expect 403 `TXN_PASSWORD_REQUIRED`.
   - `PUT admin/user/deposits/fiat/<id>/approve` with `{ transactionPassword }`. Expect 200 and `firstDepositBonus.paid: false`.
   - In the `finally`: PUT the original config back, re-read it, and assert `enabled` and the tiers are identical.
3. Submit player B's deposit from node:
   - Log in at `POST /user/auth/login`.
   - `POST /user/deposits/fiat` as multipart: `amount`, `currency=INR`, `transactionId`, `screenshot`.
4. Approve B's deposit with the transaction password. Expect `firstDepositBonus.paid: true` with the tier amount.
5. Verify:
   - Player side: `/user/wallet/balances` and `/user/bonus/first-deposit` (`claimed` only for B).
   - Admin side: `admin/reports/balance-sheet/<id>?currency=USDT` (B has the bonus row; A has none) and `admin/reports/players?channel=direct`.

## Scenario: full player lifecycle (register → referral → deposits → VIP → withdrawal)

1. **Register P1 (UI):** new isolated context → the sign-up page.
   - Username + password. Tick the 18+ box. Submit.
2. **Get P1's referral link:** `GET /user/affiliate` → `referralLink`. Locally, open the same `/referal/<CODE>` path on the local player site.
3. **Register P2 through the link (UI):** open the link in a new isolated context.
   - The site keeps the pending referral and the sign-up form prefills the code.
   - Expect:
     - P1: `GET /user/affiliate/team` → `total 1` with P2.
     - Admin player page: "referred by <P1>".
4. **P2's INR deposit (UI):** Deposit → Fiat. The form shows the first-deposit offer.
   - Fill the UTR and attach a screenshot (any PNG), then submit. Expect the "Deposit submitted" toast and the row pending in `/user/history/deposits`.
5. **Admin approves (transaction password).** Expect `firstDepositBonus.paid: true`.
   - P1 then has the referral reward: `GET /user/affiliate/rewards/unclaimed`.
6. **P2's USDT deposit:**
   - The UI's manual crypto form needs an admin USDT collection address (Admin → Bank details → USDT, network TRC20).
   - Without one, submit through the API: `POST /user/deposits/fiat` as multipart with `amount`, `currency=USDT`, `network=TRC20`, `transactionId`, `screenshot`.
   - Approve it in admin. Expect `ALREADY_PAID`, so no second bonus.
7. **Turnover / VIP screens:**
   - `/wallet/rollover`: Required = multiplier × (all deposits in USDT).
   - `/bonus`: the next VIP target and the daily/weekly unlock level.
   - Higher VIP levels need settled wager far above the betting budget: prove them on a local backend, not here.
8. **Withdrawal (UI):** `/wallet/withdraw` → currency INR.
   - Withdrawals may require verified KYC ("Complete KYC verification before withdrawing").
   - P2 submits KYC at `/settings/verification` → Basic → country → form: test text plus "TEST DOCUMENT" images.
   - The admin then approves KYC (`PUT admin/user/kyc/review {userId, status:'Verified'}`).
     - That approval may be blocked by the Claude Code permission classifier. If so, the owner approves it in Admin → KYC.
     - Then: add a test UPI or bank account, withdraw a small amount, and admin → Fiat withdrawals → decide with the transaction password.
9. **Admin checks:**
   - Users list (P1/P2).
   - P2 detail: Balance in USDT and "referred by".
   - Balance sheet: USDT shows the bonus and deposit rows; INR shows the deposit.

**Cleanup:**
- Test players keep their credits.
- Report each player (username, id, balance), any pending KYC, and P1's unclaimed referral reward.

## Withdrawal step

1. KYC must be Verified when the withdraw policy requires it. The player submits KYC through the UI. Then, from an admin tab, send `PUT admin/user/kyc/review` with `{ userId, status: 'Verified' }`.
2. As the player:
   - `POST /user/bank-accounts` with `{ method: 'upi', accountHolderName, upiId }`. Use a TEST holder name.
   - `POST /user/withdrawals/fiat` with `{ amount, currency: 'INR', bankAccountId }`. Expect `In Queue`, with the amount held from the wallet.
3. As admin: `POST admin/user/withdrawals/fiat/status` with `{ withdrawalId, status: 'Paid' }`. Expect 403 `TXN_PASSWORD_REQUIRED`.
4. Send the same request with `transactionPassword`. Expect 200 `Paid`.
5. Check the player's `/user/history`: withdrawals show Paid. Check the admin balance sheet for the INR currency: a Withdrawal −amount row.

## Game ratio (wager contribution) in one step

`node .claude/skills/live-qa/set-game-ratio.mjs <percent> [--types <percent>] [--admin <url>]`

- Needs a signed-in admin tab in the CDP Chrome (`CDP_URL`, default `http://127.0.0.1:9333`).
- Saves the rules before the change to `logs/qa/wager-ratio/before-<time>.json`, then sends the same PUT the Bonus → Wager contribution screen sends, from that tab (the admin's own save, in the Activity log), and reads it back.
- Every provider / game exception gets `<percent>`; the game types keep theirs unless `--types` is given.
- To undo, PUT the saved `rules` back the same way.

## Report

- A PASS/FAIL table, with evidence and screenshots.
- Every write made: config changes and their restore, players created, deposits approved.
- Anything skipped because of the budget.
