'use strict';

const { isProviderCallback } = require('@ibitplay/common');

/**
 * ENCRYPTION RULE — read this before touching API encryption (apiEncryption.js) or adding a
 * provider / payment route.
 *
 * Every callback and webhook BYPASSES encryption, always, whatever the owner's `api_encryption`
 * switch says — and CORS too (createApp, the same `isProviderCallback` rule). These callers are servers, not our site: they expect plain JSON, and an encrypted
 * answer breaks a bet, a deposit or a payout.
 *
 *   game callbacks      GIS / Slotegrator (/casino/gis/callback/), Original games wallet
 *                       (/casino/original-games/wallet/), JSGames v1 / v2 bet-callback,
 *                       seamless, aggregators, x-casino
 *   payment gateways    PSP callback + payout-callback (/user/psp/:provider/...),
 *                       crypto deposit webhook (/user/crypto/ccpayment/callback)
 *   anything else       any path with "callback" or "webhook" in it (OAuth google/callback too)
 *
 * A NEW game provider or payment gateway: put "callback" / "webhook" in its route path, or add
 * its prefix to PROVIDER_CALLBACK_PREFIXES (packages/common/src/createApp.js), and add a line to
 * __tests__/apiEncryption.test.js proving it stays plain.
 */
/** True when `path` is a game / payment callback: its answer is never encrypted. */
const isCallback = isProviderCallback;

module.exports = { isCallback };
