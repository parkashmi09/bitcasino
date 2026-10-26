import { useCallback } from 'react';
import { useRedeemCode } from '@/queries/rewards';

/**
 * The claim-code action `ClaimRewardDialog` calls, from the Rewards page and
 * the deposit drawer alike. `POST /user/bonus/redeem` credits a fixed amount
 * to the cash balance.
 *
 * `claim(code)` resolves `{ ok: true, amount, currency }` or
 * `{ ok: false, reason, message }` — never rejects, so the dialog only prints.
 */
export function useRewards() {
  const { mutateAsync } = useRedeemCode();

  const claim = useCallback(
    async (input) => {
      const code = String(input ?? '').trim().toUpperCase();
      if (code === '') return { ok: false, reason: 'empty' };
      try {
        const { amount, currency } = await mutateAsync({ code });
        return { ok: true, amount, currency };
      } catch (error) {
        return { ok: false, reason: error?.code ?? 'error', message: error?.message };
      }
    },
    [mutateAsync],
  );

  return { claim };
}
