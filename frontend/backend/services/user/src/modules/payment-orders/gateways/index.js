'use strict';

const crypto = require('crypto');

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
      chain,
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
 * ── WHY THIS IS CONFIGURATION AND NOT A CONSTANT ─────────────────────────
 *
 * The ids are CCPayment's, they differ per account's enabled coin set, and
 * they are not derivable from the ticker. Hardcoding a guessed number would
 * mean a deposit issued against the wrong coin — the player sends USDT to an
 * address minted for something else, and it is gone.
 *
 * So the map comes from `CCPAYMENT_COIN_IDS`, a JSON object of
 * `{"USDT": 1280, ...}` taken from the provider's coin list, and an unmapped
 * ticker is refused before anything is sent. Legacy had no map at all: the
 * caller put a number in the request body and it was forwarded as given.
 *
 * @returns the numeric id, or `null` if this deployment has not configured one.
 */
function ccpaymentCoinId(currency, config) {
  const ticker = String(currency ?? '').toUpperCase();
  if (!ticker) return null;

  let map = config?.CCPAYMENT_COIN_IDS;
  if (typeof map === 'string') {
    try {
      map = JSON.parse(map);
    } catch {
      // A malformed map means no coin is supported, which surfaces as
      // "currency not supported" rather than as a wrong coin id being sent.
      return null;
    }
  }
  if (!map || typeof map !== 'object') return null;

  const id = Number(map[ticker]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const GATEWAYS = { waypay, apay, cricpay, upi, ccpayment };

function getGateway(name) {
  return Object.prototype.hasOwnProperty.call(GATEWAYS, String(name)) ? GATEWAYS[String(name)] : null;
}

/** The reverse of `ccpaymentCoinId`, for reading a stored `coinid` back. */
function ccpaymentTicker(coinId, config) {
  let map = config?.CCPAYMENT_COIN_IDS;
  if (typeof map === 'string') {
    try {
      map = JSON.parse(map);
    } catch {
      return null;
    }
  }
  if (!map || typeof map !== 'object') return null;

  const hit = Object.entries(map).find(([, id]) => Number(id) === Number(coinId));
  return hit ? hit[0] : null;
}

module.exports = {
  GATEWAYS,
  getGateway,
  canonicalQuery,
  ccpaymentCoinId,
  ccpaymentTicker,
  formatEkqrDate,
};
