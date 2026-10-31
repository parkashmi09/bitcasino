import { makeStakeCurrency } from '../../utils/exchange/stakeCurrency';

/* bitcasino: the exchange is INR only here, so the stake currency is always the INR identity
   (hash converts to the header wallet's coin; see utils/exchange/stakeCurrency.js). */
const INR = makeStakeCurrency({ currencyName: 'INR', alias: 'INR' });

export function useExchangeCurrency() {
  return INR;
}
