'use strict';

const crypto = require('crypto');
const { AppError } = require('@ibitplay/common');

/**
 * A signed CCPayment v2 call (https://ccpayment.com/apitutorial.md §5): headers Appid, Timestamp
 * (unix seconds), Sign = hex HMAC-SHA256(APP_SECRET, Appid + Timestamp + body), the body signed
 * byte for byte as sent. `code` 10000 is success.
 *
 * Throws `CCPAYMENT_REFUSED` (`refused: true`, CCPayment answered with another code — nothing was
 * done there) or rethrows the transport error (no answer — the outcome is UNKNOWN).
 */

const OK = 10000;

const notConfigured = () => new AppError('CCPayment is not configured', 503, 'CCPAYMENT_NOT_CONFIGURED');

async function ccpaymentCall({ config, http, logger }, path, payload = null) {
  if (!config?.CCPAYMENT_BASE_URL || !config.CCPAYMENT_APP_ID || !config.CCPAYMENT_APP_SECRET || !http) {
    logger?.error('CCPayment is not configured');
    throw notConfigured();
  }
  const body = payload ? JSON.stringify(payload) : '';
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = crypto.createHmac('sha256', config.CCPAYMENT_APP_SECRET).update(`${config.CCPAYMENT_APP_ID}${timestamp}${body}`).digest('hex');
  const response = await http.raw(`${config.CCPAYMENT_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Appid: config.CCPAYMENT_APP_ID, Sign: sign, Timestamp: String(timestamp) },
    body,
  });
  if (response?.code !== OK) {
    const error = new AppError(response?.msg || 'CCPayment refused the request', 502, 'CCPAYMENT_REFUSED', { code: response?.code ?? null });
    error.refused = true;
    throw error;
  }
  return response.data ?? null;
}

/** An amount as CCPayment takes it: no trailing zeros ("10.50000000" → "10.5"). */
const plainAmount = (decimal) => String(decimal).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');

/** CCPayment's withdrawal status (getAppWithdrawRecord / ApiWithdrawal) → ours; null = not final. */
function withdrawalOutcome(status) {
  if (status === 'Success') return 'success';
  if (status === 'Failed' || status === 'Rejected') return 'failed';
  return null; // Processing, WaitingApproval
}

module.exports = { ccpaymentCall, plainAmount, withdrawalOutcome };
