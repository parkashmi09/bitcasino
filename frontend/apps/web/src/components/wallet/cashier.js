import { CURRENCY_ORDER } from '@/data/currencies';

/**
 * What the cashier may offer, from the gates (`lib/gates.js`). Pure, so the
 * header's Deposit button and the drawer agree on it.
 *
 * - `deposit` is the gateway rails (crypto address, F2Pay; `deposit_mode`
 *   automatic) and/or the manual transfer (`deposit_mode` manual + the admin's
 *   switch, `ManualDepositPanel`), so a manual-only site keeps its Deposit tab.
 * - `withdraw` stays for a withdraw-LOCKED player (`/me` `withdraw_locked`),
 *   who is told why — hash's rule. Any other `withdraw: false` hides it.
 *
 * @returns {string[]} the visible tabs/sections, in drawer order
 */
export function cashierTabs(gates, withdrawLocked = false) {
  const lockedOut = withdrawLocked && !gates.agentPlayer && gates.blocked('withdraw') === 'account';
  return [
    (gates.autoDeposit() || gates.manualDeposit()) && 'deposit',
    (gates.on('withdraw') || lockedOut) && 'withdraw',
    gates.on('swap') && 'swap',
    gates.on('vault') && 'vault',
  ].filter(Boolean);
}

/**
 * The coins the picker lists, in the wallet's order.
 *
 * `GET /user/wallet/balances` already drops the coins the owner or the site
 * switched off (keeping one only while it still holds money) and answers INR
 * alone to an agent's player, so once it has answered it IS the list. Before
 * that — or for a wallet with no row — the site's currency flags decide.
 * An agent's player sees INR only (hash `walletCoins`).
 */
export function walletCoins({ balances = {}, status, flag, agentPlayer }) {
  const held = status === 'ready' ? CURRENCY_ORDER.filter((code) => code in balances) : [];
  const list = held.length ? held : CURRENCY_ORDER.filter((code) => flag(code.toLowerCase()));
  return agentPlayer ? ['INR'] : list;
}

/** The rail a withdraw form shows: the player's pick when both are open, the open one otherwise, null for none. */
export const shownRail = ({ manual, auto, picked }) => (manual && auto ? picked : auto ? 'auto' : manual ? 'manual' : null);

// shortcut: F2Pay's BANK_INR payout range as hash hard-codes it; read it from the backend if F2Pay changes it.
export const AUTO_PAYOUT_MIN = '100';
export const AUTO_PAYOUT_MAX = '30000';

const PAYOUT_LABELS = { account_name: 'Account holder name', account_number: 'Account number', bank_code: 'IFSC code' };

/** A refused automatic payout's sentence, plus the field the server named (422 INVALID_PAYOUT_DETAILS). */
export function payoutError(error) {
  const fields = error?.details?.fields;
  const named = Array.isArray(fields)
    ? fields[0]?.message
    : Object.entries(fields ?? {}).map(([key, why]) => `${PAYOUT_LABELS[key] ?? key} ${why}`).join('; ');
  const message = error?.message || 'The withdrawal was refused.';
  return named ? `${message}: ${named}` : message;
}

/**
 * A refused deposit, in words. The player's own deposit limit (Settings, Responsible gambling)
 * says how much is left and when it resets; `RESPONSIBLE_DEPOSIT_NO_RATE` is a coin with no USD rate.
 */
export function depositError(error, fallback = 'The deposit was refused.') {
  if (error?.code === 'RESPONSIBLE_DEPOSIT_LIMIT_REACHED') {
    const { limitUsd, usedUsd, resetsAt } = error.details ?? {};
    const left = Math.max(0, Number(limitUsd) - Number(usedUsd));
    const when = resetsAt ? ` It resets ${new Date(resetsAt).toLocaleString()}.` : '';
    return Number.isFinite(left)
      ? `This goes over your deposit limit: ${left.toFixed(2)} of ${Number(limitUsd).toFixed(2)} USD left.${when}`
      : `This goes over your deposit limit.${when}`;
  }
  if (error?.code === 'RESPONSIBLE_DEPOSIT_NO_RATE') {
    return 'This coin has no USD rate right now, so your deposit limit cannot be checked. Try another coin.';
  }
  return error?.message || fallback;
}
