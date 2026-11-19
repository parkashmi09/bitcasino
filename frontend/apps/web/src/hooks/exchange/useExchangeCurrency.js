import { useMemo } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { useGates } from '@/hooks/useGates';
import { useDisplayCurrency } from '@/hooks/useWallet';
import { useExchangeRates } from '@/hooks/usePreferences';
import { AGENT_SITE } from '@/lib/agentBase';
import { exchangeCode, makeStakeCurrency } from '../../utils/exchange/stakeCurrency';

/* The rate table may carry no row for these; they are the dollar itself (backend helper/toInr.mjs). */
const ONE_USD = ['USD', 'USDT'];

/** USD per 1 unit of `code` from the platform's rate map `{currency: usdRate}`; 0 when it has no rate. */
export const usdPriceOf = (rates, code) =>
  Number(rates?.[code]) || (ONE_USD.includes(code) ? 1 : 0);

/** The coin the exchange pages work in. A signed-out visitor and an agent's player are INR only. */
export const exchangeCoin = ({ signedIn, agent, currency }) => (signedIn && !agent ? exchangeCode(currency) : 'INR');

/**
 * The header wallet's currency for the exchange pages (utils/exchange/stakeCurrency.js): stakes
 * are typed in it and every INR figure mssports sends is printed in it. INR is the identity, and
 * a coin with no rate (or rates not loaded yet) falls back to INR.
 */
export function useExchangeCurrency() {
  const { status } = useAuth();
  const { agentPlayer } = useGates();
  const [currency] = useDisplayCurrency();
  const { rates } = useExchangeRates();
  const code = exchangeCoin({ signedIn: status === 'authenticated', agent: agentPlayer || AGENT_SITE, currency });
  const usdPrice = usdPriceOf(rates, code);
  const inrUsdPrice = usdPriceOf(rates, 'INR');
  return useMemo(
    () => makeStakeCurrency({ currencyName: code, usdPrice, inrUsdPrice, alias: code }),
    [code, usdPrice, inrUsdPrice],
  );
}
