import { exchangeRequest, POLL_TIMEOUT_MS } from './api';

/**
 * ─── Stake buttons ───────────────────────────────────────────────────────────────────────
 * Ported from TENEXCH apiservices/stakeButtonService.js + oneClickButtonService.js (reads fall
 * back to the server's own seed values when the API cannot be reached; writes throw).
 */

/** The server's seed list (StakeButtonService.js) — what a new account starts with. */
export const DEFAULT_STAKE_BUTTONS = [
  { label: '1k', value: 1000 },
  { label: '2k', value: 2000 },
  { label: '5k', value: 5000 },
  { label: '10k', value: 10000 },
  { label: '20k', value: 20000 },
  { label: '25k', value: 25000 },
];
export const DEFAULT_ONE_CLICK_BUTTONS = [100, 200, 300];

/**
 * `GET /stake-button-values` (public read; per-player when signed in).
 * @returns {Promise<Array<{ label:string, value:number }>>}
 */
export async function getStakeButtons() {
  try {
    const body = await exchangeRequest('/stake-button-values', { timeout: POLL_TIMEOUT_MS });
    const rows = body?.data?.game_buttons;
    return Array.isArray(rows) && rows.length ? rows.map((b) => ({ label: String(b.label), value: Number(b.value) })) : DEFAULT_STAKE_BUTTONS;
  } catch {
    return DEFAULT_STAKE_BUTTONS;
  }
}

/** `POST /stake-button-values {game_buttons}` (player only). @returns the saved list. */
export async function saveStakeButtons(gameButtons) {
  const body = await exchangeRequest('/stake-button-values', {
    method: 'POST', json: { game_buttons: gameButtons }, auth: true,
  });
  return body?.data?.game_buttons ?? gameButtons;
}

/** One-click stakes — `GET /buttonlist`. @returns {Promise<number[]>} exactly 3 values */
export async function getOneClickButtons() {
  try {
    const body = await exchangeRequest('/buttonlist', { auth: true, timeout: POLL_TIMEOUT_MS });
    const b = body?.data?.buttons;
    return Array.isArray(b) && b.length === 3 ? b.map(Number) : DEFAULT_ONE_CLICK_BUTTONS;
  } catch {
    return DEFAULT_ONE_CLICK_BUTTONS;
  }
}

/** `POST /updatebuttonlist {buttons}` — 3 positive numbers. @returns {Promise<number[]>} */
export async function saveOneClickButtons(buttons) {
  const body = await exchangeRequest('/updatebuttonlist', { method: 'POST', json: { buttons }, auth: true });
  return (body?.data?.buttons || buttons).map(Number);
}
