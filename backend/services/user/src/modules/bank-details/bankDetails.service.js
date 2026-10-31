'use strict';

const { currencyRegistry } = require('@ibitplay/common');

const errors = require('./bankDetails.errors');
const { addressProblem } = require('./cryptoAddress');

/** For a crypto coin: the network must be one the registry enables, and the address must fit it. */
async function assertCryptoDestination(coinType, network, walletAddress) {
  const coin = await currencyRegistry.describe(coinType);
  if (coin?.kind !== 'crypto') return;
  const problem = addressProblem(network, walletAddress);
  if (problem) throw errors.CRYPTO_ADDRESS_INVALID({ coinType, network, reason: problem });
  const networks = (await currencyRegistry.networksOf(coinType)) ?? [];
  if (!networks.some((n) => n.key === network)) throw errors.NETWORK_NOT_ENABLED({ coinType, network, enabled: networks.map((n) => n.key) });
}

/**
 * The house's own payment destinations — the bank accounts and UPI ids a
 * player sends a fiat deposit to.
 *
 * Not to be confused with a player's withdrawal details. These belong to the
 * operator, which is why writing them is a staff action.
 *
 * `legacy/BankDetails/` had no authentication on any of the four routes, so
 * `POST /bankdetails/INR` let anyone add a bank account that players would then
 * be shown as the place to send money. That is a direct route to redirecting
 * deposits into an attacker's account, and it is the most commercially
 * dangerous of the unauthenticated endpoints found in this batch.
 */
class BankDetailsService {
  constructor({ models, logger }) {
    this.models = models;
    this.logger = logger;
  }

  /**
   * Active payment destinations for a currency, as shown to players.
   *
   * @legacy GET /bankdetails/:coin_type
   */
  async listActive(coinType, amount) {
    const rows = await this.models.CurrencyPaymentDetails.findAll({
      where: { coin_type: coinType, is_active: true },
      order: [['id', 'ASC']],
      raw: true,
    });

    // With the player's amount: only the destinations whose range holds it (a NULL bound is open).
    const fits = (r) => amount == null || ((r.min_amount == null || amount >= Number(r.min_amount)) && (r.max_amount == null || amount <= Number(r.max_amount)));
    return rows.filter(fits).map((r) => this.#present(r));
  }

  /** Everything, including deactivated rows — for staff. */
  async listAll(coinType) {
    const rows = await this.models.CurrencyPaymentDetails.findAll({
      where: { coin_type: coinType },
      order: [['id', 'ASC']],
      raw: true,
    });
    return rows.map((r) => this.#present(r, { includeInactive: true }));
  }

  /** @legacy POST /bankdetails/:coin_type */
  async create({ coinType, details, qrImage }) {
    await assertCryptoDestination(coinType, details.network, details.walletAddress);
    const row = await this.models.CurrencyPaymentDetails.create({
      coin_type: coinType,
      bank_name: details.bankName ?? null,
      account_number: details.accountNumber ?? null,
      ifsc_code: details.ifscCode ?? null,
      account_holder_name: details.accountHolderName ?? null,
      upi_id: details.upiId ?? null,
      network: details.network ?? null,
      wallet_address: details.walletAddress ?? null,
      qr_image: qrImage ?? null,
      is_active: details.isActive ?? true,
      min_amount: details.minAmount ?? null,
      max_amount: details.maxAmount ?? null,
    });

    this.logger?.info({ coinType, id: row.id }, 'Payment destination added');
    return this.#present(row.get({ plain: true }), { includeInactive: true });
  }

  /** @legacy PUT /bankdetails/:coin_type/:id */
  async update({ coinType, id, details, qrImage }) {
    const row = await this.models.CurrencyPaymentDetails.findOne({
      where: { id, coin_type: coinType },
    });
    if (!row) throw errors.NOT_FOUND({ id, coinType });
    if (details.network !== undefined || details.walletAddress !== undefined) {
      await assertCryptoDestination(coinType, details.network ?? row.network, details.walletAddress ?? row.wallet_address);
    }

    const min = details.minAmount !== undefined ? details.minAmount : row.min_amount;
    const max = details.maxAmount !== undefined ? details.maxAmount : row.max_amount;
    if (min != null && max != null && Number(min) > Number(max)) throw errors.AMOUNT_RANGE_INVALID({ min, max });

    await row.update({
      ...(details.minAmount !== undefined ? { min_amount: details.minAmount } : {}),
      ...(details.maxAmount !== undefined ? { max_amount: details.maxAmount } : {}),
      ...(details.bankName !== undefined ? { bank_name: details.bankName } : {}),
      ...(details.accountNumber !== undefined ? { account_number: details.accountNumber } : {}),
      ...(details.ifscCode !== undefined ? { ifsc_code: details.ifscCode } : {}),
      ...(details.accountHolderName !== undefined ? { account_holder_name: details.accountHolderName } : {}),
      ...(details.upiId !== undefined ? { upi_id: details.upiId } : {}),
      ...(details.network !== undefined ? { network: details.network } : {}),
      ...(details.walletAddress !== undefined ? { wallet_address: details.walletAddress } : {}),
      ...(details.isActive !== undefined ? { is_active: details.isActive } : {}),
      ...(qrImage ? { qr_image: qrImage } : {}),
    });

    this.logger?.info({ coinType, id }, 'Payment destination updated');
    return this.#present(row.get({ plain: true }), { includeInactive: true });
  }

  /**
   * @legacy DELETE /bankdetails/:coin_type/:id
   *
   * Deactivates rather than deletes, matching legacy. A destination that
   * historical deposits reference must stay resolvable.
   */
  async deactivate({ coinType, id }) {
    const row = await this.models.CurrencyPaymentDetails.findOne({
      where: { id, coin_type: coinType },
    });
    if (!row) throw errors.NOT_FOUND({ id, coinType });

    await row.update({ is_active: false });
    this.logger?.warn({ coinType, id }, 'Payment destination deactivated');
    return { id, coinType, isActive: false };
  }

  /**
   * Shape a row for the client.
   *
   * The QR image is a BYTEA column holding the raw file. Returning it inline
   * would put a few hundred KB of base64 into every list response, so the row
   * carries a flag and the image is fetched from its own endpoint.
   */
  #present(row, { includeInactive = false } = {}) {
    return {
      id: row.id,
      coinType: row.coin_type,
      bankName: row.bank_name,
      accountNumber: row.account_number,
      ifscCode: row.ifsc_code,
      accountHolderName: row.account_holder_name,
      upiId: row.upi_id,
      network: row.network ?? null,
      walletAddress: row.wallet_address ?? null,
      hasQrImage: Boolean(row.qr_image),
      minAmount: row.min_amount == null ? null : Number(row.min_amount),
      maxAmount: row.max_amount == null ? null : Number(row.max_amount),
      ...(includeInactive ? { isActive: row.is_active } : {}),
    };
  }

  /** The QR image bytes for one destination. */
  async getQrImage({ coinType, id }) {
    const row = await this.models.CurrencyPaymentDetails.findOne({
      where: { id, coin_type: coinType },
      attributes: ['id', 'qr_image'],
      raw: true,
    });
    if (!row?.qr_image) throw errors.NOT_FOUND({ id, coinType });
    return row.qr_image;
  }
}

module.exports = { BankDetailsService };
