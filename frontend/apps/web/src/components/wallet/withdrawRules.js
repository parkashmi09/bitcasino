/**
 * Pure helpers for the cashier's whitelist, withdrawal requirements and manual deposit
 * (hash `services/withdrawal.js`, `fiatDeposit.js`). Kept out of the components so they test alone.
 */

const fmt = (value, currency) => `${value} ${currency}`;

/**
 * What still blocks a withdrawal, one line each, from `GET /user/withdrawals/requirements`.
 * `[]` when nothing does (or nothing was read: the backend still checks on submit).
 * Wagering owed only on a bonus does not block: that bonus is forfeited with the withdrawal
 * (`wager.remainingAfterForfeit` is what still blocks after it).
 */
export function requirementLines(req) {
  if (!req || req.ok !== false || !Array.isArray(req.missing)) return [];
  const bonusOnly = req.bonusForfeitAllowed === true && !(Number(req.wager?.remainingAfterForfeit) > 0);
  return req.missing.filter((key) => !(key === 'wager' && bonusOnly)).map((key) => {
    if (key === 'kyc') return 'Verify your identity (KYC) before withdrawing.';
    if (key === 'wager') {
      const left = req.wager?.remainingAfterForfeit ?? req.wager?.remaining;
      return Number(left) > 0 ? `Wager ${fmt(left, req.wager.currency ?? 'USD')} more before withdrawing.` : 'Finish your wagering before withdrawing.';
    }
    if (key === 'cap') return 'You have reached your withdrawal limit for this coin. Deposit or wager more to raise it.';
    if (key === 'daily') return 'You have reached today’s withdrawal limit. Try again later.';
    return `Withdrawal requirement not met: ${key}.`;
  });
}

/** Info lines: what is left of the withdrawal cap and of today's limit for this coin. */
export function limitLines(req) {
  const lines = [];
  const cap = req?.cap;
  const daily = req?.dailyLimit;
  if (cap?.enabled && cap.remaining != null) lines.push(`Withdrawal cap: ${fmt(cap.remaining, cap.currency)} left to withdraw.`);
  if (daily?.enabled && daily.remaining != null) lines.push(`Daily limit: ${daily.remaining} of ${fmt(daily.limit, daily.currency)} left today.`);
  return lines;
}

/**
 * The active bonuses a withdrawal forfeits (`"10 USDT, 5 INR"`) when the player must agree to it
 * first (`forfeitBonus: true` on submit), else null.
 */
export function forfeitNotice(req) {
  if (!req?.bonusForfeitRequired || !req.bonusForfeitAllowed) return null;
  return (req.wager?.bonus?.bonuses ?? []).map((b) => fmt(b.amount, b.currency)).join(', ');
}

/** The saved addresses a withdrawal of `currency` (on `network`, when set) may go to. */
export function savedFor(addresses, currency, network) {
  const coin = String(currency).toUpperCase();
  const chain = network ? String(network).toUpperCase() : null;
  return (Array.isArray(addresses) ? addresses : []).filter(
    (row) => String(row.currency).toUpperCase() === coin && (!chain || !row.network || String(row.network).toUpperCase() === chain),
  );
}

/** Same rule as the backend validator: 4-190 characters, letters, digits and `:_-` only. */
export const isAddressShape = (value) => /^[A-Za-z0-9:_-]{4,190}$/.test(String(value ?? '').trim());

const DESTINATION_FIELDS = ['bankName', 'accountNumber', 'ifscCode', 'accountHolderName', 'upiId', 'network', 'walletAddress'];

/**
 * The multipart fields for `POST /user/deposits/fiat`: only what the (strict) validator
 * declares, with the paid-into account's own details and nothing empty.
 */
export function manualDepositFields({ amount, currency, reference, account }) {
  const fields = { amount: String(amount), currency: String(currency).toUpperCase(), transactionId: String(reference).trim() };
  for (const key of DESTINATION_FIELDS) {
    if (account?.[key]) fields[key] = String(account[key]);
  }
  return fields;
}

/** What a fiat payout needs: the holder plus a UPI id, or full bank details (backend fiatWithdraw.validators). */
export function fiatDestinationReady({ method, holder, upiId, bankName, accountNumber, ifsc }, currency) {
  if (!holder.trim()) return false;
  if (method === 'upi') return currency === 'INR' && upiId.trim().length > 0;
  return Boolean(bankName.trim() && accountNumber.trim() && ifsc.trim());
}
