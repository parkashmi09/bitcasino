# Issue: admin balance sheet misses sports exposure releases

**Status:** admin balance sheet fixed 21 Oct 2026: its sports rows are now each bet's P/L — the user's `SportsBet` ids, then the `SPORTS` rows of `mssports.point_ledger_direct` (direct user) or `mssports.point_ledger` (agent user) — and an open bet's hold is `openExposure` (from `mssports.total_exposures`), added back in `unexplained`. No bet placed / release / settlement cash rows any more, so nothing is absorbed and the 2-decimal remainder is gone. Bets settled before migration 117 (17 Oct 2026, 21:53) have no point-ledger row and are missing (parkertester01 −2040, parkertester02 −200 in `unexplained`). `debit_ledger` still gets no release row; the admin user statement still misses it. **Player Wallet → Transaction pane and admin Ledger tab fixed 22 Oct 2026** (`wallet.repository.js` `listLedger` / `listStaffHistory`): a direct user's stake holds and exposure releases come from `point_ledger_direct` (`BET_PLACED` / `BET_RELEASED`, exact `balance_after`; the release is "Sports bet released", reason `SPORTS_RELEASE`), `debit_ledger` only for bets that ledger has no row for; agent-tree users' releases are still unrecorded (no ledger holds them). Found on live, 21 Oct 2026 (run h2, player `parkertest12`, id 9596657868).
**Re-checked on live, 22 Oct 2026 03:25 IST (parkertest12):** the balance sheet is right (each bet its own row, the fancy reads −550, live = ledger, `unexplained` 0). The player Wallet → Transaction pane still misses the release: "Sports bet −₹34.50 → ₹1,228.68" (the LAY), no row for the BACK's +₹23, then "Sports settlement ₹0.00 → ₹1,251.68". Source: `services/user/src/modules/wallet/wallet.repository.js` `listLedger` (player pane) and `listStaffHistory` (admin Ledger tab) still read `debit_ledger` bet_placed + `credits_ledger` only.
**Severity:** reporting only. Wallet balances and totals are right; no money is lost or created.

## Symptom

On admin → player → Balance sheet (INR), some sports rows show the wrong market name and amount:

- A settlement row is named after one market but carries money from another.
  Live example: `Settlement — Cricket / Afghanistan v Bangladesh / Normal / P Hossain Emon balls / 96` shows **+35**. That fancy bet (NO 81 @110, result 96) lost and moved nothing; the +35 came from Match Odds hedging.
- A "Bet placed" row shows a **positive** amount (e.g. `13:48:10 Bet placed +57`), although placing a bet never raises the balance.
- Between the missing move and the next row, `unexplained` is non-zero.

The player's own statement (`/sports/statement`) shows the same period correctly.

## Evidence (parkertest12, 21 Oct 2026, UTC)

| Source | Rows after 13:50 |
|---|---|
| Player statement (`POST /api/v1/sports/user/account-statement-direct`, `reportType: TRANSACTION`) | 13:50:03 bet 157 −36 → 52 · 13:50:10 bet 158 +36 → 88 · 13:50:17 bet 159 −36 → 52 · 13:50:25 bet 160 +35 → 87 |
| Admin balance sheet (`GET /api/v1/admin/reports/balance-sheet/9596657868?currency=INR`) | 13:50:03 Bet placed → 52, shown as **+33** (earlier missing releases fold into it the same way) · **14:51:18 Settlement — P Hossain Emon balls / 96 +35 → 87** |

Bets 158–160 are missing from the admin sheet. Their net (+36 −36 +35 = +35) lands on the next row that has a balance, the 14:51 fancy settlement.

## Root cause

1. **Sports placement writes no ledger row when a bet lowers exposure.**
   `backend/services/sports/src/modules/bets/controllers/sportbetscontroller.mjs`, `walletUpdate`:
   - `balanceChange > 0` (exposure up): wallet debited, `mssports.debit_ledger` row `reason: 'bet_placed'` with `balance` written.
   - `balanceChange < 0` (exposure down, e.g. a BACK after a LAY on the same runner): wallet credited (`BET_RELEASED` in `point_ledger_direct`), but **no `debit_ledger` row** is written. `releaseAmount` is computed and never used.
2. **The admin balance sheet takes each sports row's move as `post − running`.**
   `backend/services/admin/src/modules/reports/reports.service.js`:
   - Section 6b reads only `mssports.debit_ledger` (`reason = 'bet_placed'`) and `mssports.credits_ledger` (`settlement`, `refund`, `settlement_void`).
   - `balanceSheet()` (around line 1330) computes `minor = post − running` and drops rows that moved 0.
   - So a release with no row is invisible, and the next row with a `post` absorbs it under its own label.
3. The player statement reads `mssports.point_ledger_direct` (`DirectStatementService.mjs`), which does record `BET_RELEASED`. That is why the player side is right.

## How to reproduce

Use any direct player (no agent parent), INR balance ≥ ₹300, one open Match Odds market. Cost is about ₹1 (the hedge spread).

1. Note the player's INR balance.
2. LAY ₹100 on a runner. The wallet drops by the liability, e.g. −₹36.
3. BACK ₹100 on the same runner at a similar price. The exposure falls and the wallet rises, e.g. +₹35.
4. Open admin → the player → Balance sheet, INR.
   - **Expected:** a row for step 3 (+35).
   - **Actual:** no row for step 3, and `unexplained` = 35 (live balance is 35 above the ledger).
5. Place any further bet, or let the market settle.
   - **Actual:** that next row shows its own move plus the missing +35, under its own description. `unexplained` returns to 0.

Step 4's non-zero `unexplained` is the clearest check.

**Reproduced on live, 22 Oct 2026 02:27 IST** (parkertest12, Sporting Lisbon v LASK Linz, Match Odds): LAY LASK ₹1,150 @1.03 (−34.50), then BACK LASK ₹1,150 @1.02 (exposure 34.50 → 11.50, wallet +23). Admin sheet right after: `live 1251.68090881`, `ledger 1228.68`, **`unexplained 23.00090881`**; the newest row is the LAY's "Bet placed −34.50", with no row for the +23.

## Two smaller findings from the same check

- **`openExposure` is the open stake, not the exposure.** The sheet showed `openExposure 2300.00` (the two ₹1,150 stakes) while the player's real exposure was ₹11.50. Section "Stakes on unsettled bets" sums `stake_amount`; for a hedged book it should read the exposure (the exchange's exposure table), or be renamed "Open stake".
- **Sports rows round the wallet to 2 decimals.** `debit_ledger.balance` / `credits_ledger.closing` store 1228.68 while `credits.inr` is 1228.68090881 (a swap left 8-decimal INR). `post − running` then leaks the sub-paisa remainder (0.00090881) into `unexplained` and into the next row's amount. Either store the full wallet value or quantise `credits.inr` writes to 2 decimals.

## Suggested fix

1. In `walletUpdate`, when `balanceChange < 0`, write a `mssports.debit_ledger` row (e.g. `reason: 'bet_released'`, `amount` = the release, `balance` = `newBalance`, same `description`, `match_id`, `event_id`, `meta.bet_id`).
2. In `reports.service.js` section 6b, read `reason IN ('bet_placed', 'bet_released')` and push a release as a CREDIT (`Exposure released — <description>`).
3. Check any other reader of `debit_ledger` that sums `bet_placed` amounts (admin exchange reports, statements), so a new reason does not change their totals.
4. Tests:
   - sports: a LAY then a BACK on one runner writes one `bet_placed` and one `bet_released` row with the right `balance`;
   - admin: a balance sheet with that pair shows both rows, and `unexplained` is 0 after each.

## Verify after the fix

Repeat "How to reproduce". After step 3, the admin sheet shows a +35 "Exposure released" row with `unexplained` 0. After step 5, the next row shows only its own move.
