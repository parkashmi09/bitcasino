'use strict';

const { money } = require('@ibitplay/common');
const { fn, col, where } = require('@ibitplay/db');

const errors = require('./exchangeRate.errors');
const { isCustomCurrency } = require('../wallet/wallet.constants');

/**
 * A rate the site admin may not write: any custom coin's (the owner sets it
 * in the owner panel and admin-service applies it, migration 065), and any row
 * the owner's apply has tagged `managed_by = 'owner'`.
 */
function assertSiteManaged(currency, row) {
  if (isCustomCurrency(currency) || row?.managed_by === 'owner') {
    throw errors.OWNER_MANAGED({ currency: String(currency).toUpperCase() });
  }
}

/**
 * Currency conversion rates.
 *
 * Every rate is stored as "how many USD is one unit of this currency worth",
 * so a conversion is always `from -> USD -> to`. That indirection is what keeps
 * the table O(n) instead of needing a rate for every possible pair.
 *
 * Two things this fixes from `legacy/exchangerate/controller.js`:
 *
 *   1. **The write endpoints had no authentication.** `POST /rates`,
 *      `PUT /rates/:currency` and `DELETE /rates/:currency` were reachable by
 *      anyone. Setting a rate changes what every subsequent swap pays out, so
 *      that was a direct route to draining balances. They are staff-only now.
 *
 *   2. **Rates were JavaScript floats.** A rate of 0.00001234 multiplied by a
 *      balance in a double loses precision in exactly the place that matters
 *      for a satoshi-denominated currency. Rates are strings end to end and go
 *      through `money`, which works in BigInt minor units.
 */
/** CoinGecko id → our code. Stablecoins are pegged: written as 1.0 every run. */
const COINGECKO_IDS = {
  bitcoin: 'BTC', ethereum: 'ETH', litecoin: 'LTC', 'bitcoin-cash': 'BCH', binancecoin: 'BNB', ripple: 'XRP',
  cardano: 'ADA', tron: 'TRX', dogecoin: 'DOGE', 'matic-network': 'MATIC', 'shiba-inu': 'SHIB', nexo: 'NEXO', maker: 'MKR',
};
const STABLECOINS = ['USDT', 'USDC', 'BUSD', 'TUSD', 'USDP'];
const FIAT_CODES = ['INR', 'PKR', 'AED', 'NPR', 'BDT', 'MVR', 'EUR'];

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

/** USD value of one unit, from CoinGecko (crypto) and open.er-api (fiat). A feed that fails is left out. */
async function fetchMarketRates() {
  const [crypto, fiat] = await Promise.allSettled([
    getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${Object.keys(COINGECKO_IDS).join(',')}&vs_currencies=usd`),
    getJson('https://open.er-api.com/v6/latest/USD'),
  ]);
  const rates = Object.fromEntries(STABLECOINS.map((code) => [code, 1]));
  if (crypto.status === 'fulfilled') {
    for (const [id, code] of Object.entries(COINGECKO_IDS)) {
      const usd = Number(crypto.value[id]?.usd);
      if (usd > 0) rates[code] = usd;
    }
  }
  if (fiat.status === 'fulfilled') {
    for (const code of FIAT_CODES) {
      const perUsd = Number(fiat.value.rates?.[code]);
      if (perUsd > 0) rates[code] = 1 / perUsd;
    }
  }
  return { rates, failed: [crypto, fiat].filter((r) => r.status === 'rejected').map((r) => r.reason.message) };
}

class ExchangeRateService {
  constructor({ models, db, logger }) {
    this.models = models;
    this.db = db;
    this.logger = logger;
  }

  /**
   * @legacy GET /exchangeRate/rates
   * @legacy GET /rate
   *
   * `GET /rate` returned `Market.rate()` — an in-memory object maintained by a
   * background poller, with `Access-Control-Allow-Origin: *` set on the
   * response. Two endpoints for the same question, one reading the table and
   * one reading a process-local cache that a second instance would not share.
   * This reads the table, which is the copy every service agrees on.
   */
  async listRates() {
    const rows = await this.models.Exchangerate.findAll({
      order: [['currency', 'ASC']],
      raw: true,
    });

    return rows.map((r) => ({
      currency: String(r.currency).toUpperCase(),
      usdRate: money.toDecimalString(money.toMinor(r.usd_rate ?? '0')),
      lastUpdated: r.last_updated,
    }));
  }

  /** @legacy GET /exchangeRate/rates/:currency */
  async getRate(currency) {
    const row = await this.#findRate(currency);
    if (!row) throw errors.RATE_NOT_FOUND({ currency });

    return {
      currency: String(row.currency).toUpperCase(),
      usdRate: money.toDecimalString(money.toMinor(row.usd_rate ?? '0')),
      lastUpdated: row.last_updated,
    };
  }

  /**
   * Convert an amount between two currencies.
   *
   * @legacy GET /exchangeRate/convert
   * @legacy GET /exchangeRate/convert/:from/:to/:amount
   */
  async convert({ from, to, amount }) {
    if (from === to) {
      return {
        from, to,
        amount: money.toDecimalString(money.toMinor(amount)),
        converted: money.toDecimalString(money.toMinor(amount)),
        rate: '1.00000000',
      };
    }

    const [fromRate, toRate] = await Promise.all([this.#requireRate(from), this.#requireRate(to)]);

    // amount -> USD -> target. Both steps in BigInt minor units.
    const usdValue = money.multiply(amount, fromRate);
    const converted = money.divide(money.toDecimalString(usdValue), toRate);

    return {
      from,
      to,
      amount: money.toDecimalString(money.toMinor(amount)),
      converted: money.toDecimalString(converted),
      usdValue: money.toDecimalString(usdValue),
      rate: money.toDecimalString(money.divide(fromRate, toRate)),
    };
  }

  /** @legacy POST /exchangeRate/rates */
  async addRate({ currency, usdRate }) {
    assertSiteManaged(currency);
    const existing = await this.#findRate(currency);
    if (existing) throw errors.RATE_ALREADY_EXISTS({ currency });

    const row = await this.models.Exchangerate.create({
      currency,
      usd_rate: usdRate,
      last_updated: new Date(),
    });

    this.logger?.info({ currency, usdRate }, 'Exchange rate added');
    return { currency, usdRate, id: row.id };
  }

  /** @legacy PUT /exchangeRate/rates/:currency */
  async updateRate({ currency, usdRate }) {
    const existing = await this.#findRate(currency);
    if (!existing) throw errors.RATE_NOT_FOUND({ currency });
    assertSiteManaged(currency, existing);

    const previous = money.toDecimalString(money.toMinor(existing.usd_rate ?? '0'));

    await this.models.Exchangerate.update(
      { usd_rate: usdRate, last_updated: new Date() },
      { where: { id: existing.id } }
    );

    // Rate changes are worth a log line of their own: a swap that looks wrong
    // an hour later is usually a rate that moved, and this is the record.
    this.logger?.info({ currency, previous, usdRate }, 'Exchange rate updated');

    return { currency, usdRate, previousRate: previous };
  }

  /**
   * Hourly job: every site-managed row with a market price gets it. Rows the owner manages and
   * codes the feeds do not carry keep their rate; a failed feed changes nothing.
   */
  async refreshFromMarket() {
    const { rates, failed } = await fetchMarketRates();
    if (failed.length) this.logger?.warn({ failed }, 'Exchange rate feed failed');

    const rows = await this.models.Exchangerate.findAll({ raw: true });
    const updated = [];
    for (const row of rows) {
      const code = String(row.currency).toUpperCase();
      const usd = rates[code];
      if (!usd || row.managed_by === 'owner' || isCustomCurrency(code)) continue;
      await this.models.Exchangerate.update(
        { usd_rate: usd.toFixed(8), last_updated: new Date() },
        { where: { id: row.id } }
      );
      updated.push(code);
    }
    this.logger?.info({ updated }, 'Exchange rates refreshed from market');
    return { updated, failed };
  }

  /** @legacy DELETE /exchangeRate/rates/:currency */
  async deleteRate(currency) {
    const existing = await this.#findRate(currency);
    if (!existing) throw errors.RATE_NOT_FOUND({ currency });
    assertSiteManaged(currency, existing);

    const removed = await this.models.Exchangerate.destroy({ where: { id: existing.id } });
    this.logger?.warn({ currency }, 'Exchange rate deleted');
    return { currency, removed };
  }

  /**
   * Case-insensitive lookup.
   *
   * The legacy table holds a mixture of "usdt", "USDT" and "Usdt" — the write
   * endpoints never normalised — so an exact match silently misses rows.
   */
  async #findRate(currency) {
    return this.models.Exchangerate.findOne({
      where: where(fn('UPPER', col('currency')), String(currency).toUpperCase()),
      raw: true,
    });
  }

  async #requireRate(currency) {
    const row = await this.#findRate(currency);
    /* USD and USDT ARE the unit (1:1). A site whose rate table lacks a USDT row used to throw
       here for every non-USD stake, so no INR / BTC bet counted toward VIP, commission or bonus. */
    if (!row && ['USD', 'USDT'].includes(String(currency ?? '').toUpperCase())) return '1.00000000';
    if (!row) throw errors.RATE_NOT_FOUND({ currency });

    const rate = money.toDecimalString(money.toMinor(row.usd_rate ?? '0'));
    if (money.lte(rate, '0')) throw errors.INVALID_RATE({ currency, rate });
    return rate;
  }
}

module.exports = { ExchangeRateService, fetchMarketRates };
