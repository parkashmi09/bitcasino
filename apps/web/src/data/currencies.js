/**
 * The currencies a wallet can hold, and how to draw one.
 *
 * The list is `SUPPORTED_CURRENCIES` from
 * `backend/services/user/src/modules/wallet/wallet.constants.js` — the
 * allow-list the `credits` table is columned by. `GET /user/wallet/balances`
 * answers a subset of these keys, so anything the header renders has to be
 * describable from here.
 *
 * `decimals` is a DISPLAY precision, not a storage one. Every balance is
 * `NUMERIC(30,8)` server-side; showing eight places for a rupee balance is
 * just noise, and showing two for a Bitcoin one hides the money.
 *
 * `tint` is the coin's own brand colour, used for the disc the ticker sits on.
 * The reference serves real coin artwork from imgix; this project has no
 * licence to those marks, so it draws the same 20px disc with the ticker's
 * initial in it — a placeholder that is honestly a placeholder rather than a
 * traced logo.
 */

const CRYPTO = 8;
const FIAT = 2;

/**
 * What the WALLET's own surfaces print, as opposed to `decimals` above.
 *
 * The reference's balances panel shows `0.00` on every row, Bitcoin included,
 * and labels the Bitcoin one `0.00 mBTC` — read off its own phone panel, where
 * the amount column is 45px wide. It does not show a coin's storage precision
 * there: eight places would be a 92px column of zeroes, which is exactly what
 * this app was drawing before anyone compared the two.
 *
 * So a currency may carry a display UNIT — `shift` decimal places to the right
 * and a name for the result. Bitcoin's is the reference's default, milli-BTC.
 * Nothing else has one: a row reading `0.00` is already denominated by its own
 * label, and only a unit that differs from the ticker needs saying.
 */
export const WALLET_DECIMALS = 2;

/** ticker -> { name, decimals, tint, unit?, shift? } */
export const CURRENCIES = {
  BTC: { name: 'Bitcoin', decimals: CRYPTO, tint: '#f7931a', unit: 'mBTC', shift: 3 },
  ETH: { name: 'Ethereum', decimals: CRYPTO, tint: '#627eea' },
  LTC: { name: 'Litecoin', decimals: CRYPTO, tint: '#345d9d' },
  BCH: { name: 'Bitcoin Cash', decimals: CRYPTO, tint: '#8dc351' },
  USDT: { name: 'Tether', decimals: FIAT, tint: '#26a17b' },
  TRX: { name: 'Tron', decimals: CRYPTO, tint: '#eb0029' },
  DOGE: { name: 'Dogecoin', decimals: CRYPTO, tint: '#c2a633' },
  ADA: { name: 'Cardano', decimals: CRYPTO, tint: '#0033ad' },
  XRP: { name: 'Ripple', decimals: CRYPTO, tint: '#23292f' },
  BNB: { name: 'Binance coin', decimals: CRYPTO, tint: '#f3ba2f' },
  USDP: { name: 'Pax Dollar', decimals: FIAT, tint: '#00845d' },
  NEXO: { name: 'Nexo', decimals: CRYPTO, tint: '#1a4199' },
  MKR: { name: 'Maker', decimals: CRYPTO, tint: '#1aab9b' },
  TUSD: { name: 'TrueUSD', decimals: FIAT, tint: '#002868' },
  USDC: { name: 'USD Coin', decimals: FIAT, tint: '#2775ca' },
  BUSD: { name: 'Binance USD', decimals: FIAT, tint: '#f0b90b' },
  NC: { name: 'Casino Credit', decimals: FIAT, tint: '#7e7572' },
  INR: { name: 'Indian Rupee', decimals: FIAT, tint: '#138808' },
  SHIB: { name: 'Shiba Inu', decimals: CRYPTO, tint: '#f00500' },
  MATIC: { name: 'Polygon', decimals: CRYPTO, tint: '#8247e5' },
  SC: { name: 'Siacoin', decimals: CRYPTO, tint: '#20ee82' },
  MVR: { name: 'Maldivian Rufiyaa', decimals: FIAT, tint: '#d21034' },
  BJB: { name: 'BJB', decimals: FIAT, tint: '#5c33cf' },
  AED: { name: 'UAE Dirham', decimals: FIAT, tint: '#00732f' },
  NPR: { name: 'Nepalese Rupee', decimals: FIAT, tint: '#dc143c' },
  PKR: { name: 'Pakistani Rupee', decimals: FIAT, tint: '#01411c' },
  EUR: { name: 'Euro', decimals: FIAT, tint: '#003399' },
  BDT: { name: 'Bangladeshi Taka', decimals: FIAT, tint: '#006a4e' },
};

/**
 * What the chip falls back to before `/wallet/balances` answers, and what it
 * offers a wallet that holds nothing at all. `USDT` first because it is the
 * account default on the platform and the one every fiat rail settles into.
 */
export const DEFAULT_CURRENCY = 'USDT';

/** Every ticker the wallet knows, in the order the balances panel lists them. */
export const CURRENCY_ORDER = Object.keys(CURRENCIES);

/**
 * What `Preferred FIAT currency` on the settings page offers, in the
 * reference's own order — which is NOT alphabetical and not the wallet's.
 *
 * Separate from `CURRENCIES` on purpose: these are DISPLAY targets, the
 * currency the site quotes a balance in, not currencies a wallet can hold.
 * Only `EUR` and `INR` are in both lists, and folding them together would
 * put `JPY` in the deposit drawer's coin picker, where the platform has no
 * column for it.
 *
 * `name` is resolved rather than written out, the way `countries.js` resolves
 * country names — `Intl.DisplayNames` has the currency table too, and pinning
 * `en` keeps one set of names for every visitor.
 */
export const FIAT_DISPLAY_CURRENCIES = (() => {
  const codes = ['EUR', 'JPY', 'USD', 'CNY', 'CAD', 'THB', 'AUD', 'BRL', 'INR', 'VND'];
  let names;
  try {
    names = new Intl.DisplayNames(['en'], { type: 'currency' });
  } catch {
    return codes.map((code) => ({ code, name: code }));
  }
  return codes.map((code) => ({ code, name: names.of(code) ?? code }));
})();

/** The one the site quotes in until the player picks another. */
export const DEFAULT_FIAT = 'USD';

export const currencyMeta = (code) =>
  CURRENCIES[code] ?? { name: code, decimals: FIAT, tint: '#7e7572' };

/**
 * Which chains a coin can be deposited over.
 *
 * The reference's drawer puts this directly above the QR, because for a
 * multi-chain coin it is the choice that decides whether the money arrives:
 * USDT sent to a Tron address over Ethereum is gone. So the row is a picker
 * and not a caption, even though the address it would qualify is not
 * available yet — a player has to be able to see which chain the screen is
 * talking about before they read anything off it.
 *
 * These are public network names, not account data: nothing here is invented
 * and nothing here is a promise that this build can issue an address on that
 * chain. `label` is what the reference writes in the row (`Tron Network`),
 * `short` is the badge on the coin disc.
 *
 * Coins absent from this map are single-chain — their own network, named
 * after them — which `currencyNetworks` fills in rather than each of the
 * twenty-odd entries restating it.
 */
const NETWORKS = {
  USDT: [
    { id: 'TRX', label: 'Tron Network', short: 'TRX' },
    { id: 'ETH', label: 'Ethereum Network', short: 'ERC20' },
    { id: 'BSC', label: 'BNB Smart Chain', short: 'BEP20' },
  ],
  USDC: [
    { id: 'ETH', label: 'Ethereum Network', short: 'ERC20' },
    { id: 'TRX', label: 'Tron Network', short: 'TRX' },
    { id: 'MATIC', label: 'Polygon Network', short: 'MATIC' },
  ],
  BUSD: [
    { id: 'BSC', label: 'BNB Smart Chain', short: 'BEP20' },
    { id: 'ETH', label: 'Ethereum Network', short: 'ERC20' },
  ],
  TUSD: [{ id: 'ETH', label: 'Ethereum Network', short: 'ERC20' }],
  USDP: [{ id: 'ETH', label: 'Ethereum Network', short: 'ERC20' }],
  NEXO: [{ id: 'ETH', label: 'Ethereum Network', short: 'ERC20' }],
  MKR: [{ id: 'ETH', label: 'Ethereum Network', short: 'ERC20' }],
  SHIB: [{ id: 'ETH', label: 'Ethereum Network', short: 'ERC20' }],
  BNB: [{ id: 'BSC', label: 'BNB Smart Chain', short: 'BEP20' }],
  MATIC: [
    { id: 'MATIC', label: 'Polygon Network', short: 'MATIC' },
    { id: 'ETH', label: 'Ethereum Network', short: 'ERC20' },
  ],
};

/**
 * `[{ id, label, short }]` for a coin, never empty. A fiat balance has no
 * chain at all, which is why this can answer `[]` — the drawer hides the row
 * rather than inventing a network for a rupee.
 */
export function currencyNetworks(code) {
  if (NETWORKS[code]) return NETWORKS[code];
  const meta = CURRENCIES[code];
  if (!meta || meta.decimals === FIAT) return [];
  return [{ id: code, label: `${meta.name} Network`, short: code }];
}
