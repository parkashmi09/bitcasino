'use strict';

const { AppError } = require('@ibitplay/common');

const { callParent } = require('./hubCredentials');

/**
 * Copy side: a gateway adapter that runs on the PARENT's account. payment-orders uses it in place
 * of the real adapter on a whitelabel copy (`#gateway`), so the copy's own checks, records, holds
 * and refunds are unchanged; only "ask the gateway" becomes "ask the parent" (modules/wl-hub).
 * `supports`, `payIn`, `needsCustomer`, … stay the real adapter's.
 */

const notOffered = (provider) => new AppError('This payment provider is currently unavailable', 503, 'PROVIDER_DISABLED', { provider });

/** The parent's withdrawal charge (percent string) for `provider`, or PROVIDER_DISABLED. */
async function withdrawalChargePct(deps, provider) {
  const { fees } = await callParent(deps, 'GET', '/payments/terms');
  const pct = fees?.[provider]?.withdraw;
  if (pct === undefined) throw notOffered(provider);
  return String(pct);
}

function hubGateway(real, name, deps) {
  return {
    ...real,
    requiredConfig: [],

    async createDeposit(params) {
      try {
        const data = await callParent(deps, 'POST', '/payments/deposit', {
          provider: name,
          copyReference: params.reference,
          userId: String(params.userId),
          currency: params.currency,
          amount: String(params.amount),
          method: params.payIn?.method ?? params.method ?? undefined,
          chain: params.chain ?? undefined,
          returnUrl: params.returnUrl ?? undefined,
          customer: params.customer ?? undefined,
          ip: params.ip ?? undefined,
        });
        if (!data?.ok) return { ok: false, message: data?.message ?? 'The payment provider refused the order' };
        return { ok: true, providerReference: data.providerReference, redirectUrl: data.redirectUrl, details: data.details };
      } catch (error) {
        // Refused by the parent: nothing was opened there. Anything else: the deposit fails here,
        // and if the parent did open it, its outcome still reaches this copy and is applied.
        if (error.refused) return { ok: false, message: error.message };
        throw error;
      }
    },

    /**
     * The payout. An answer we never got is NOT a failure: the parent may have sent it. So ask
     * the parent what became of it; only "never opened" refunds. Still no answer: it stays
     * pending (player and company stay held) until the parent's outcome arrives.
     */
    async createWithdrawal(params) {
      const body = {
        provider: name,
        copyReference: params.reference,
        userId: String(params.userId),
        currency: params.currency,
        amount: String(params.amount),
        method: params.method,
        details: params.details,
        customer: params.customer ?? undefined,
        chargePct: String(params.chargePct ?? '0'),
      };
      try {
        const data = await callParent(deps, 'POST', '/payments/payout', body);
        if (!data?.ok) return { ok: false, message: data?.message ?? 'The payment provider refused the payout' };
        return { ok: true, providerReference: data.providerReference };
      } catch (error) {
        if (error.refused) return { ok: false, message: error.message };
        deps.logger?.error({ err: error, provider: name, reference: params.reference }, 'No answer from the parent for a payout — asking what became of it');
        try {
          const order = await callParent(deps, 'GET', `/payments/order?flow=payout&copyReference=${encodeURIComponent(params.reference)}`);
          if (order?.status === 'failed') return { ok: false, message: 'The payment provider refused the payout' };
          return { ok: true, providerReference: order?.providerReference ?? null };
        } catch (second) {
          if (second.refused && second.status === 404) return { ok: false, message: 'The payout never reached the parent site' };
          deps.logger?.fatal({ err: second, provider: name, reference: params.reference }, 'Payout outcome unknown — left pending until the parent reports it');
          return { ok: true, providerReference: null };
        }
      }
    },
  };
}

module.exports = { hubGateway, withdrawalChargePct };
