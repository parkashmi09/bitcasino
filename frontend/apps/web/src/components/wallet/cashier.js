import { CURRENCY_ORDER } from '@/data/currencies';

/**
 * What the cashier may offer, from the gates (`lib/gates.js`). Pure, so the
 * header's Deposit button and the drawer agree on it.
 *
 * - `deposit` is the gateway rails (crypto address, F2Pay), both AUTOMATIC on
 *   the backend (`deposit_mode: automatic`). This drawer has no manual bank
 *   transfer form, so a manual-only site has no Deposit tab here.
 * - `withdraw` stays for a withdraw-LOCKED player (`/me` `withdraw_locked`),
 *   who is told why — hash's rule. Any other `withdraw: false` hides it.
 *
 * @returns {string[]} the visible tabs/sections, in drawer order
 */
export function cashierTabs(gates, withdrawLocked = false) {
  const lockedOut = withdrawLocked && !gates.agentPlayer && gates.blocked('withdraw') === 'account';
  return [
    gates.autoDeposit() && 'deposit',
    gates.on('buy') && 'buy',
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
  return agentPlayer && list.includes('INR') ? ['INR'] : list;
}
