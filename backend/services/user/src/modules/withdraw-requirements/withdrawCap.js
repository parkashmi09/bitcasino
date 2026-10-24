'use strict';

/**
 * The deposit cap's figures (deposited / withdrawn / wagered per currency) now live in
 * `@ibitplay/common` (withdrawalCapFigures.js) so the admin's Users → Financial screen reads the
 * same numbers. Same exports as before.
 */
const { createCapFigures, CCPAYMENT_COINS } = require('@ibitplay/common').withdrawalCapFigures;

module.exports = { createCapFigures, CCPAYMENT_COINS };
