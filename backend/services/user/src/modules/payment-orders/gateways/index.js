'use strict';

const crypto = require('crypto');

const { CCPAYMENT_COINS } = require('@ibitplay/common').withdrawalCapFigures;
const {
  WAYPAY_MERCHANT_IDS,
  APAY_DEPOSIT_SYSTEMS,
  APAY_WITHDRAWAL_SYSTEMS,
  WAYPAY_CODES,
} = require('../paymentOrders.constants');

/**
 * The OUTBOUND half of each payment integration — asking a provider to collect
 * money from a player, or to send money to one.
 *
 * `modules/psp/providers` is the inbound half: it decides whether a callback is
 * genuine. These two live apart because they answer different questions and
 * fail in different directions. Inbound, the dangerous mistake is trusting
 * something you should not. Outbound, it is sending a request you cannot later
 * account for.
 *
 * Each gateway answers the same questions:
 *
 *   supports(currency, flow)  can this provider do this at all?
 *   createDeposit(...)        ask for money, return where to send the player
 *   createWithdrawal(...)     send money, return the provider's reference
 *
 * The service above owns everything that is not provider-specific: who the user
 * is, whether they have the balance, holding it, recording the order, and
 * refunding if the gateway says no.
 *
 * ── ON CREDENTIALS ───────────────────────────────────────────────────────
 * Every one of these providers had its live production keys written into the
 * source: WayPay's merchant key, A-Pay's API and webhook private keys, and
 * CricPay's AES key and IV. They are read from configuration here, and the
 * old values must be treated as compromised — they have been in the repository
 * history, and rotating them is not optional.
 */

/** `key=value&…` over sorted, non-empty keys — the shape WayPay signs. */
function canonicalQuery(params, exclude = ['sign']) {
  return Object.keys(params)
    .filter((k) => !exclude.includes(k))
    .filter((k) => params[k] !== '' && params[k] !== null && params[k] !== undefined)
    .sort()
    .map((k) => `${k}=${String(params[k])}`)
    .join('&');
}

// ══════════════════════════════════════════════════════════════════════
//  WayPay
// ══════════════════════════════════════════════════════════════════════
const waypay = {
  name: 'waypay',
  requiredConfig: ['WAYPAY_MERCHANT_KEY', 'WAYPAY_BASE_URL'],

  supports(currency) {
    return Object.prototype.hasOwnProperty.call(WAYPAY_MERCHANT_IDS, currency);
  },

  sign(payload, config) {
    return crypto
      .createHash('md5')
      .update(`${canonicalQuery(payload)}&key=${config.WAYPAY_MERCHANT_KEY}`)
      .digest('hex')
      .toLowerCase();
  },

  async createDeposit({ reference, currency, amount, method, notifyUrl, returnUrl, phone }, config, { http }) {
    const payload = {
      mchId: WAYPAY_MERCHANT_IDS[currency],
      currency,
      out_trade_no: reference,
      pay_type: method,
      money: String(amount),
      attach: '',
      // OUR url, always. Legacy took `notify_url` from the request body, which
      // let the caller choose where the provider reported the result.
      notify_url: notifyUrl,
      ...(returnUrl ? { returnUrl } : {}),
      ...(phone ? { phone } : {}),
    };
    payload.sign = this.sign(payload, config);

    const response = await http.form(`${config.WAYPAY_BASE_URL}/v1/Collect`, payload);
    return interpretWaypay(response);
  },

  async createWithdrawal({ reference, currency, amount, method, notifyUrl, details }, config, { http }) {
    const payload = {
      mchId: WAYPAY_MERCHANT_IDS[currency],
      currency,
      out_trade_no: reference,
      pay_type: method || 'BANK',
      account: details.account_number,
      userName: details.account_name,
      money: String(amount),
      attach: '',
      notify_url: notifyUrl,
      reserve1: details.bank_code,
    };
    payload.sign = this.sign(payload, config);

    const response = await http.form(`${config.WAYPAY_BASE_URL}/v1/Payout`, payload);
    return interpretWaypay(response);
  },

  /** Patch a missing bank reference onto a settled payment. */
  async repairUtr({ reference, utr }, config, { http }) {
    const payload = { mchId: WAYPAY_MERCHANT_IDS.INR, utr, out_trade_no: reference };
    payload.sign = this.sign(payload, config);
    return interpretWaypay(await http.form(`${config.WAYPAY_BASE_URL}/v1/UtrRepair`, payload));
  },
};

/**
 * WayPay answers with `{code, msg, data}`, where ONLY code 0 is success.
 *
 * The legacy code tested `response.data.code === 0` when storing the
 * transaction but never checked it before replying, so a rejected order was
 * returned to the client as though it had worked — the player got a failure
 * page and no record of it existed on our side.
 */
function interpretWaypay(response) {
  const code = Number(response?.code);
  if (code === 0) {
    return {
      ok: true,
      providerReference: response.data?.transaction_Id ?? null,
      redirectUrl: response.data?.payUrl ?? response.data?.url ?? null,
      raw: response,
    };
  }
  return {
    ok: false,
    code,
    message: WAYPAY_CODES[code] ?? response?.msg ?? 'unknown provider error',
    raw: response,
  };
}

// ══════════════════════════════════════════════════════════════════════
//  A-Pay
// ══════════════════════════════════════════════════════════════════════
const apay = {
  name: 'apay',
  requiredConfig: ['APAY_API_KEY', 'APAY_PROJECT_ID', 'APAY_BASE_URL'],

  supports(currency, flow) {
    const table = flow === 'payout' ? APAY_WITHDRAWAL_SYSTEMS : APAY_DEPOSIT_SYSTEMS;
    return Object.prototype.hasOwnProperty.call(table, currency);
  },

  systemFor(currency, flow) {
    return (flow === 'payout' ? APAY_WITHDRAWAL_SYSTEMS : APAY_DEPOSIT_SYSTEMS)[currency];
  },

  async createDeposit({ reference, userId, currency, amount, method, returnUrl }, config, { http }) {
    const response = await http.post(
      `${config.APAY_BASE_URL}/Remotes/create-payment-page`,
      {
        amount: String(amount),
        currency,
        payment_system: method || this.systemFor(currency, 'payin'),
        custom_transaction_id: reference,
        custom_user_id: String(userId),
        return_url: returnUrl || config.APAY_RETURN_URL,
        language: 'EN',
        webhook_id: Number(config.APAY_DEPOSIT_WEBHOOK_ID ?? config.APAY_PROJECT_ID),
      },
      { headers: { apikey: config.APAY_API_KEY } }
    );

    if (!response?.success) {
      return { ok: false, message: response?.message ?? 'deposit request failed', raw: response };
    }
    return {
      ok: true,
      providerReference: response.order_id ?? null,
      redirectUrl: response.url ?? response.payment_url ?? null,
      raw: response,
    };
  },

  async createWithdrawal({ reference, userId, currency, amount, method, details }, config, { http }) {
    const paymentSystem = method || this.systemFor(currency, 'payout');
    const url = `${config.APAY_BASE_URL}/Remotes/create-withdrawal?project_id=${encodeURIComponent(config.APAY_PROJECT_ID)}`;

    const response = await http.post(
      url,
      {
        amount: String(amount),
        currency,
        payment_system: paymentSystem,
        custom_transaction_id: reference,
        custom_user_id: String(userId),
        data: details,
        ...(config.APAY_WITHDRAWAL_WEBHOOK_ID ? { webhook_id: config.APAY_WITHDRAWAL_WEBHOOK_ID } : {}),
      },
      { headers: { apikey: config.APAY_API_KEY } }
    );

    if (!response?.success) {
      return { ok: false, message: response?.message ?? 'withdrawal request failed', raw: response };
    }
    return { ok: true, providerReference: response.order_id ?? null, raw: response };
  },

  /** What the provider believes about an order. */
  async getDepositInfo(orderId, config, { http }) {
    return http.get(
      `${config.APAY_BASE_URL}/Remotes/deposit-info?project_id=${encodeURIComponent(config.APAY_PROJECT_ID)}&order_id=${encodeURIComponent(orderId)}`,
      { headers: { apikey: config.APAY_API_KEY } }
    );
  },

  /** Every payment system A-Pay has switched on for this project (admin Payment Methods page). */
  async getPaymentSystems(config, { http }) {
    const response = await http.get(
      `${config.APAY_BASE_URL}/Remotes/payment-systems-info?project_id=${encodeURIComponent(config.APAY_PROJECT_ID)}`,
      { headers: { apikey: config.APAY_API_KEY } }
    );
    if (!response?.success || !Array.isArray(response.payment_systems)) {
      throw new Error(response?.message || 'payment-systems-info returned no list');
    }
    return response.payment_systems;
  },
};

// ══════════════════════════════════════════════════════════════════════
//  CricPay — INR only
// ══════════════════════════════════════════════════════════════════════
const cricpay = {
  name: 'cricpay',
  requiredConfig: ['CRICPAY_MERCHANT_CODE', 'CRICPAY_BASE_URL'],

  supports(currency) {
    return currency === 'INR';
  },

  async createDeposit({ reference, userId, amount, method, userName }, config, { http }) {
    const response = await http.post(`${config.CRICPAY_BASE_URL}/api/appuser/loginPaymentGateway`, {
      merchantCode: config.CRICPAY_MERCHANT_CODE,
      transaction_code: reference,
      amount: String(amount),
      userId: String(userId),
      paymentMethod: method,
      userName,
    });

    if (response?.status !== 'Success') {
      return { ok: false, message: response?.message ?? 'payment request failed', raw: response };
    }
    return { ok: true, redirectUrl: response.accessURL ?? null, raw: response };
  },

  async createWithdrawal({ reference, userId, amount, details }, config, { http }) {
    const response = await http.post(`${config.CRICPAY_BASE_URL}/api/appuser/doWithdraw`, {
      merchantCode: config.CRICPAY_MERCHANT_CODE,
      transaction_code: reference,
      amount: String(amount),
      userId: String(userId),
      account_holder: details.account_name,
      account_number: details.account_number,
      ifsc_code: details.bank_code,
    });

    if (response?.status !== 'Success') {
      return { ok: false, message: response?.message ?? 'payout request failed', raw: response };
    }
    return { ok: true, providerReference: response.transaction_id ?? null, raw: response };
  },

  /** Which deposit and withdrawal rails CricPay currently has switched on. */
  async getAvailableMethods(config, { http }) {
    const response = await http.get(
      `${config.CRICPAY_BASE_URL}/api/appuser/checkDWStatus/${encodeURIComponent(config.CRICPAY_MERCHANT_CODE)}`
    );
    return response?.status === 'Success' ? (response.data?.[0] ?? null) : null;
  },

  /** The provider's own view of a transaction — see psp/providers for why. */
  async getStatus(reference, config, { http }) {
    return http.post(`${config.CRICPAY_BASE_URL}/api/appuser/checkStatusByTrn`, {
      merchantCode: config.CRICPAY_MERCHANT_CODE,
      transaction_code: reference,
    });
  },
};

// ══════════════════════════════════════════════════════════════════════
//  UPI Gateway — INR only, deposits only
// ══════════════════════════════════════════════════════════════════════
const upi = {
  name: 'upi',
  requiredConfig: ['UPI_API_KEY', 'UPI_BASE_URL'],

  supports(currency, flow) {
    return currency === 'INR' && flow !== 'payout';
  },

  async createDeposit({ reference, amount, customerName, customerMobile, redirectUrl }, config, { http }) {
    const response = await http.form(`${config.UPI_BASE_URL}/api/create-order`, {
      key: config.UPI_API_KEY,
      client_txn_id: reference,
      amount: String(amount),
      p_info: 'Deposit',
      customer_name: customerName,
      customer_mobile: customerMobile,
      // The gateway requires an email; it is not used for anything we rely on.
      customer_email: config.UPI_CUSTOMER_EMAIL || 'noreply@example.com',
      redirect_url: redirectUrl || config.UPI_REDIRECT_URL,
    });

    if (!response?.status) {
      return { ok: false, message: response?.msg ?? 'order creation failed', raw: response };
    }
    return {
      ok: true,
      providerReference: response.data?.order_id ?? null,
      redirectUrl: response.data?.payment_url ?? null,
      raw: response,
    };
  },

  /**
   * @legacy POST /checkorderstatusupi
   *
   * EkQR wants the transaction DATE alongside the id, and it wants it in
   * `dd-mm-yyyy`. Legacy took that date from the request body, so a caller
   * could probe an id against different dates until one matched.
   *
   * Here the date comes from the order row we already hold — the caller names
   * a reference they own and nothing else.
   */
  async getStatus(reference, config, { http }, order) {
    const response = await http.form(`${config.UPI_BASE_URL}/api/check_order_status`, {
      key: config.UPI_API_KEY,
      client_txn_id: reference,
      // The string stored when the order was created, not one re-derived here.
      txn_date: order?.transactionDate ?? formatEkqrDate(order?.createdAt, config.UPI_TIMEZONE),
    });

    if (!response?.status) {
      return { ok: false, message: response?.msg ?? 'status lookup failed', raw: response };
    }
    return { ok: true, status: response.data?.status ?? null, raw: response };
  },
};

/**
 * EkQR's `dd-mm-yyyy`, in the gateway's own timezone.
 *
 * ── WHY THIS IS NOT `new Date()` ─────────────────────────────────────────
 *
 * The legacy version built it like this:
 *
 *     const istOffset = 5.5 * 60 * 60 * 1000;
 *     const istDate = new Date(date.getTime() + istOffset);
 *     `${istDate.getDate()}-${istDate.getMonth() + 1}-${istDate.getFullYear()}`
 *
 * It adds 5½ hours to the epoch and then reads the result with `getDate()`,
 * `getMonth()` and `getFullYear()` — which are the LOCAL accessors. On a server
 * already running in IST that shifts the date twice, so for 5½ hours out of
 * every 24 the order was filed under tomorrow. The status lookup then sent that
 * same wrong date to the gateway and got "not found" for a real payment.
 *
 * `Intl` with an explicit timezone does the conversion once, and does it
 * correctly on any host.
 */
function formatEkqrDate(when, timeZone = 'Asia/Kolkata') {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(when ? new Date(when) : new Date());

  const at = (type) => parts.find((p) => p.type === type)?.value;
  return `${at('day')}-${at('month')}-${at('year')}`;
}

// ══════════════════════════════════════════════════════════════════════
//  CCPayment — crypto deposit addresses
// ══════════════════════════════════════════════════════════════════════

/**
 * A per-player, per-order deposit address on a chain.
 *
 * Different in kind from the other four: nothing is collected at request time.
 * The provider hands back an address, the player sends coin to it whenever they
 * like, and `/api/ccpaymentnotify` reports the confirmation later. So an order
 * here is an intent with no expiry, and the reference has to survive until it
 * is either funded or forgotten.
 *
 * ── THE ORDER ID CAME FROM THE REQUEST BODY ──────────────────────────────
 *
 *     const { coinId, price, orderId, chain, ..., userid } = req.body;
 *
 * `orderId` is the key the callback resolves a payment against, and the caller
 * chose it — on an unauthenticated route that also took `userid` from the body.
 * Submitting an `orderId` that another player is already waiting on points that
 * player's incoming deposit at whichever row the callback finds. The reference
 * is generated by the service here and is never accepted from a request.
 */
const ccpayment = {
  name: 'ccpayment',
  requiredConfig: ['CCPAYMENT_APP_ID', 'CCPAYMENT_APP_SECRET', 'CCPAYMENT_BASE_URL'],

  supports(currency, flow, config) {
    // Crypto in only. CCPayment does support payouts; legacy never wired one,
    // and claiming support for an untested payout path is how money leaves.
    return flow !== 'payout' && ccpaymentCoinId(currency, config) != null;
  },

  /** The coins CCPayment offers this account (or CCPAYMENT_COIN_IDS) — the Crypto tab offers CCPayment for these only. */
  async getAvailableMethods(config, { http }) {
    await refreshCcpaymentCoinIds(config, http);
    const fixed = configuredCoinIds(config);
    return Object.keys(Object.keys(fixed).length ? fixed : liveCoinIds);
  },

  /**
   * CCPayment signs `appId + timestamp + body` with HMAC-SHA256.
   *
   * The signature covers the body BYTE FOR BYTE, so the exact string that is
   * signed has to be the exact string that is sent. Serialising twice — once to
   * sign, once to send — is the classic way to get a signature error out of a
   * correct payload, because key order or spacing can differ.
   */
  sign(body, timestamp, config) {
    return crypto
      .createHmac('sha256', config.CCPAYMENT_APP_SECRET)
      .update(`${config.CCPAYMENT_APP_ID}${timestamp}${body}`)
      .digest('hex');
  },

  headers(body, config) {
    const timestamp = Math.floor(Date.now() / 1000);
    return {
      'Content-Type': 'application/json',
      Appid: config.CCPAYMENT_APP_ID,
      Sign: this.sign(body, timestamp, config),
      Timestamp: String(timestamp),
    };
  },

  /** @legacy POST /createDeposit */
  async createDeposit({ reference, currency, amount, chain, returnUrl }, config, { http }) {
    const body = JSON.stringify({
      // CCPayment identifies coins NUMERICALLY, not by ticker — and
      // `ccdeposit.coinid` is an INTEGER column because of it. Legacy took
      // `coinId` straight from the request body, so the caller supplied the
      // number and nothing checked it against the coin they claimed to send.
      coinId: ccpaymentCoinId(currency, config),
      price: String(amount),
      orderId: reference,
      chain: ccpaymentChain(chain),
      generateCheckoutURL: true,
      returnUrl: returnUrl || config.CCPAYMENT_RETURN_URL,
    });

    const response = await http.raw(
      `${config.CCPAYMENT_BASE_URL}/ccpayment/v2/createAppOrderDepositAddress`,
      { method: 'POST', headers: this.headers(body, config), body }
    );

    // 10000 is CCPayment's success code. Legacy compared it correctly here and
    // then reported `res.status(400).send('Error: ' + msg)` as a bare string,
    // so the client got a 400 with no code to branch on.
    if (response?.code !== CCPAYMENT_OK) {
      return { ok: false, message: response?.msg ?? 'deposit address creation failed', raw: response };
    }

    return {
      ok: true,
      providerReference: response.data?.address ?? null,
      redirectUrl: response.data?.checkoutUrl ?? null,
      // The address, memo and confirmation count are what the player needs on
      // screen; the service stores them on the order row.
      details: {
        address: response.data?.address ?? null,
        memo: response.data?.memo ?? null,
        amount: response.data?.amount ?? null,
        confirmsNeeded: response.data?.confirmsNeeded ?? null,
      },
      raw: response,
    };
  },

  /** @legacy POST /getOrder */
  async getStatus(reference, config, { http }) {
    const body = JSON.stringify({ orderId: reference });
    const response = await http.raw(
      `${config.CCPAYMENT_BASE_URL}/ccpayment/v2/getAppOrderInfo`,
      { method: 'POST', headers: this.headers(body, config), body }
    );

    if (response?.code !== CCPAYMENT_OK) {
      return { ok: false, message: response?.msg ?? 'order lookup failed', raw: response };
    }
    return { ok: true, status: response.data?.status ?? null, raw: response };
  },
};

const CCPAYMENT_OK = 10000;

/**
 * Ticker → CCPayment's numeric coin id.
 *
 * CCPayment identifies coins by ITS number (USDT 1280, BTC 1155), the same on every account, and
 * hands the list out itself (`getCoinList`). So nothing has to be stored: the ids come from that
 * live list (`refreshCcpaymentCoinIds`, cached 10 min), then from the table the reports already
 * read (`CCPAYMENT_COINS`). `CCPAYMENT_COIN_IDS` (JSON `{"USDT":1280}`) is an optional override
 * that replaces both. Legacy had no map at all: the caller put a number in the request body.
 *
 * @returns the numeric id, or `null` for a coin none of them knows.
 */
function ccpaymentCoinId(currency, config) {
  const ticker = String(currency ?? '').toUpperCase();
  if (!ticker) return null;

  const id = Number(coinIdMap(config)[ticker]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** `CCPAYMENT_COIN_IDS` as an object — a string is JSON; malformed or absent is `{}`. */
function configuredCoinIds(config) {
  let map = config?.CCPAYMENT_COIN_IDS;
  if (typeof map === 'string') {
    try {
      map = JSON.parse(map);
    } catch {
      return {};
    }
  }
  return map && typeof map === 'object' ? map : {};
}

const KNOWN_COIN_IDS = Object.fromEntries(Object.entries(CCPAYMENT_COINS).map(([id, ticker]) => [ticker, Number(id)]));
let liveCoinIds = {};
let liveCoinIdsAt = 0;

function coinIdMap(config) {
  const fixed = configuredCoinIds(config);
  return Object.keys(fixed).length ? fixed : { ...KNOWN_COIN_IDS, ...liveCoinIds };
}

/** CCPayment's own coin list → `liveCoinIds`. Skipped while the override is set or the list is under 10 min old. */
async function refreshCcpaymentCoinIds(config, http) {
  if (Object.keys(configuredCoinIds(config)).length || Date.now() - liveCoinIdsAt < 600_000) return;
  const response = await http.raw(`${config.CCPAYMENT_BASE_URL}/ccpayment/v2/getCoinList`, {
    method: 'POST',
    headers: ccpayment.headers('', config),
    body: '',
  });
  if (response?.code !== CCPAYMENT_OK) throw new Error(response?.msg ?? 'CCPayment coin list failed');
  liveCoinIds = Object.fromEntries(
    (response.data?.coins ?? []).filter((coin) => Number(coin.coinId) > 0).map((coin) => [String(coin.symbol).toUpperCase(), Number(coin.coinId)])
  );
  liveCoinIdsAt = Date.now();
}

/**
 * The site's network name → CCPayment's chain symbol. The Crypto tab sends bc.game's names
 * (TRON, ETHEREUM, BITCOIN…) and older callers the token standard (TRC20…); CCPayment knows
 * the chain (TRX, ETH, BTC…). Anything else is already CCPayment's (BSC, POLYGON, TON…).
 */
const CCPAYMENT_CHAINS = Object.freeze({
  TRON: 'TRX', TRC20: 'TRX', ETHEREUM: 'ETH', ERC20: 'ETH', BEP20: 'BSC', BITCOIN: 'BTC', SOLANA: 'SOL',
});
const ccpaymentChain = (chain) => {
  const name = String(chain ?? '').toUpperCase();
  return CCPAYMENT_CHAINS[name] ?? name;
};

// ══════════════════════════════════════════════════════════════════════
//  F2Pay — INR deposits through F2Pay's UPI cashier page
// ══════════════════════════════════════════════════════════════════════

/**
 * Every request is `{ traceId, merchantId, signType: 'RSA', bizContent, sign }`: `bizContent` is a
 * JSON STRING and `sign` is RSA-SHA256 over exactly that string with our private key, so the
 * string that is signed is the string that is sent. F2Pay answers (and calls back, see
 * psp/providers) in the same shape, signed with the key F2PAY_PUBLIC_KEY checks. `code: '0000'`
 * is success. Every key and id is configuration (backend/.env), none is in the source.
 */
const f2pay = {
  name: 'f2pay',
  requiredConfig: ['F2PAY_MERCHANT_ID', 'F2PAY_BASE_URL', 'F2PAY_PRIVATE_KEY', 'F2PAY_PUBLIC_KEY'],
  // The cashier page asks for the payer's name, email and phone: the service reads the player's own.
  needsCustomer: true,
  // F2Pay opens only for currencies switched on by the owner (owner panel → F2Pay, `flags.f2pay_inr` …,
  // missing = on) AND the Super Admin (Settings → Payment Methods). One key for both.
  currencySwitch: (currency) => `f2pay_${String(currency).toLowerCase()}`,

  // Its methods are rows of `payment_methods` (owner + Super Admin, migration 153); the service reads them.
  methodsInDb: true,

  supports(currency, flow) {
    // Deposits only for now (user, 2026-10-24) — the payout below stays commented out. The player
    // pays in the currency they deposit and is credited in it: no conversion anywhere.
    return flow !== 'payout' && Boolean(F2PAY_PAYIN[currency]);
  },

  /**
   * The method the player picked among `methods` (the on ones, `[{ method, currency }]`) in
   * `currency` — none picked = its first — with that currency's endpoint and decimals. Null = not offered.
   */
  payIn(currency, method, methods) {
    const own = methods.filter((m) => m.currency === currency);
    const picked = method ? own.find((m) => m.method === method) : own[0];
    return picked ? { ...picked, ...F2PAY_PAYIN[currency] } : null;
  },

  async createDeposit({ reference, userId, amount, payIn, notifyUrl, returnUrl, customer, ip }, config, { http }) {
    if (!payIn) return { ok: false, message: 'That payment method is not available' };
    // More decimals than F2Pay takes (INR 2, IDR 0) would make its callback amount differ from ours.
    if (!new RegExp(`^\\d+${payIn.decimals ? `(\\.\\d{1,${payIn.decimals}})?` : ''}$`).test(String(amount))) {
      return { ok: false, message: payIn.decimals ? `Amount can have at most ${payIn.decimals} decimals` : 'Amount must be a whole number' };
    }
    const phone = String(customer?.phone ?? '').replace(/\D/g, '');
    const bizContent = JSON.stringify({
      amount: Number(amount).toFixed(payIn.decimals),
      body: 'Account deposit',
      customerEmail: customer?.email || 'noreply@example.com',
      customerIpAddress: ip || undefined,
      customerName: customer?.name || `Player${userId}`,
      // India: the last 10 digits (a stored "+91 98…" still works). No phone: a placeholder.
      customerPhone: (payIn.currency === 'INR' ? phone.slice(-10) : phone) || payIn.placeholderPhone,
      mchOrderNo: reference,
      methodCode: payIn.method,
      notifyUrl,
      returnUrl: returnUrl || config.F2PAY_RETURN_URL,
      subject: 'Wallet top-up',
    });

    const response = await http.post(`${config.F2PAY_BASE_URL}${payIn.path}`, f2payRequest(reference, bizContent, config));
    return interpretF2pay(response, config);
  },

  /*
   * PAYOUT — kept commented out on purpose (user, 2026-10-24: "payout wala code abhi ke liye
   * comment kar dena"). To switch it on: uncomment this, let `supports` return true for
   * 'payout', and add F2Pay to `#recordPendingWithdrawal` / psp `#findPayout` with a
   * f2paywithdrawals table. F2Pay's payout callback status is `Completed` / `Failed`.
   *
  async createWithdrawal({ reference, amount, notifyUrl, details }, config, { http }) {
    const bizContent = JSON.stringify({
      amount: Number(amount).toFixed(2),
      mchOrderNo: reference,
      methodCode: 'BANK_INR',
      notifyUrl,
      customerAccountNum: details.account_number,
      customerName: details.account_name,
      ifsc: details.bank_code,
      customerPhone: details.phone,
      customerEmail: details.email,
    });
    const response = await http.post(`${config.F2PAY_BASE_URL}/payout/inr/order/create`, f2payRequest(reference, bizContent, config));
    return interpretF2pay(response, config);
  },
   */
};

/** Per currency F2Pay collects in (F2Pay's docs): its endpoint, how many decimals the amount carries. */
const F2PAY_PAYIN = Object.freeze({
  INR: { path: '/payin/inr/order/create', decimals: 2, placeholderPhone: '9999999999' },
  IDR: { path: '/payin/idr/order/create', decimals: 0, placeholderPhone: '081234567890' },
});

/** A key from .env: PEM as-is (`\n` escapes allowed), or the bare base64 body F2Pay's dashboard shows. */
function f2payKey(value, kind) {
  const text = String(value ?? '').replace(/\\n/g, '\n').trim();
  if (text.includes('-----BEGIN')) return text;
  const key = Buffer.from(text, 'base64');
  return kind === 'private'
    ? crypto.createPrivateKey({ key, format: 'der', type: 'pkcs8' })
    : crypto.createPublicKey({ key, format: 'der', type: 'spki' });
}

/** RSA-SHA256 over `bizContent` with our private key, base64. */
function f2paySign(bizContent, config) {
  return crypto.createSign('RSA-SHA256').update(String(bizContent), 'utf8').sign(f2payKey(config.F2PAY_PRIVATE_KEY, 'private'), 'base64');
}

/** True when `sign` is F2Pay's RSA-SHA256 signature over `bizContent`. Never throws. */
function f2payVerify(bizContent, sign, config) {
  if (typeof bizContent !== 'string' || typeof sign !== 'string' || !sign) return false;
  try {
    return crypto.createVerify('RSA-SHA256').update(bizContent, 'utf8').verify(f2payKey(config.F2PAY_PUBLIC_KEY, 'public'), sign, 'base64');
  } catch {
    return false;
  }
}

function f2payRequest(reference, bizContent, config) {
  return { traceId: reference, merchantId: config.F2PAY_MERCHANT_ID, signType: 'RSA', bizContent, sign: f2paySign(bizContent, config) };
}

/** `{code, msg, bizContent, sign}` — only '0000' with F2Pay's own signature is success. */
function interpretF2pay(response, config) {
  if (response?.code !== '0000') {
    return { ok: false, code: response?.code, message: response?.msg ?? 'F2Pay refused the order', raw: response };
  }
  if (!f2payVerify(response.bizContent, response.sign, config)) {
    return { ok: false, message: 'F2Pay answer failed its signature check', raw: response };
  }
  const biz = JSON.parse(response.bizContent); // { mchOrderNo, platNo, payUrl, … }
  return { ok: true, providerReference: biz.platNo ?? null, redirectUrl: biz.payUrl ?? null, raw: response };
}

const GATEWAYS = { waypay, apay, cricpay, upi, ccpayment, f2pay };

function getGateway(name) {
  return Object.prototype.hasOwnProperty.call(GATEWAYS, String(name)) ? GATEWAYS[String(name)] : null;
}

/** The reverse of `ccpaymentCoinId`, for reading a stored `coinid` back. */
function ccpaymentTicker(coinId, config) {
  const hit = Object.entries(coinIdMap(config)).find(([, id]) => Number(id) === Number(coinId));
  return hit ? hit[0] : null;
}

module.exports = {
  GATEWAYS,
  getGateway,
  canonicalQuery,
  ccpaymentCoinId,
  ccpaymentTicker,
  ccpaymentChain,
  refreshCcpaymentCoinIds,
  formatEkqrDate,
  f2paySign,
  f2payVerify,
};
