import { useCallback } from 'react';
import { useRedeemCode } from '@/queries/rewards';
import { api } from '@/lib/api';
import { ENDPOINTS } from '@/lib/endpoints';
import { refreshBalances } from '@/hooks/useWallet';

/**
 * A code that is not a bonus code may be a gift card key: activate it, then claim it.
 * Keys are matched as typed (not upper-cased). Already activated = go straight to the claim.
 */
async function claimGiftCard(key) {
  let giftCardId;
  try {
    ({ giftCardId } = await api(ENDPOINTS.giftCardRedeem, { method: 'POST', body: { code: key } }));
  } catch (error) {
    if (error?.code !== 'GIFTCARD_ALREADY_ACTIVATED' || !error?.details?.giftCardId) throw error;
    giftCardId = error.details.giftCardId;
  }
  try {
    const paid = await api(ENDPOINTS.giftCardClaim, { method: 'POST', body: { giftCardId } });
    refreshBalances();
    return { ok: true, amount: paid.amount, currency: paid.currency };
  } catch (error) {
    if (/^GIFTCARD_(DEPOSIT|WAGER)_CONDITION_UNMET$/.test(error?.code ?? '')) {
      const what = error.code.includes('DEPOSIT') ? 'deposit' : 'wager';
      return { ok: false, reason: error.code, message: `Gift card activated. Complete the ${what} requirement, then enter the code again to claim it.` };
    }
    throw error;
  }
}

/**
 * The claim-code action `ClaimRewardDialog` calls, from the Rewards page and
 * the deposit drawer alike. `POST /user/bonus/redeem` credits a fixed amount
 * to the cash balance.
 *
 * `claim(code)` resolves `{ ok: true, amount, currency }` or
 * `{ ok: false, reason, message }` — never rejects, so the dialog only prints.
 */
const NOT_A_BONUS = new Set(['BONUS_CODE_NOT_FOUND', 'VALIDATION_ERROR', 'NOT_ENTITLED']);
const NOT_A_GIFT = new Set(['GIFTCARD_NOT_FOUND', 'VALIDATION_ERROR', 'NOT_ENTITLED']);

export function useRewards() {
  const { mutateAsync } = useRedeemCode();

  const claim = useCallback(
    async (input) => {
      const typed = String(input ?? '').trim();
      const code = typed.toUpperCase();
      if (code === '') return { ok: false, reason: 'empty' };
      try {
        const { amount, currency } = await mutateAsync({ code });
        return { ok: true, amount, currency };
      } catch (error) {
        // A gift card key may break the bonus-code rules (VALIDATION_ERROR) or bonus may be off the plan.
        if (!NOT_A_BONUS.has(error?.code)) return { ok: false, reason: error?.code ?? 'error', message: error?.message };
        try {
          return await claimGiftCard(typed);
        } catch (giftError) {
          // Neither a bonus code nor a gift card: keep the bonus wording.
          const reason = NOT_A_GIFT.has(giftError?.code) ? error.code : giftError?.code ?? 'error';
          return { ok: false, reason, message: reason === error.code ? error.message : giftError?.message };
        }
      }
    },
    [mutateAsync],
  );

  return { claim };
}
