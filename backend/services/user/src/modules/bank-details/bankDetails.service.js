'use strict';

const errors = require('./bankDetails.errors');

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
  async listActive(coinType) {
    const rows = await this.models.CurrencyPaymentDetails.findAll({
      where: { coin_type: coinType, is_active: true },
      order: [['id', 'ASC']],
      raw: true,
    });

    return rows.map((r) => this.#present(r));
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
    const row = await this.models.CurrencyPaymentDetails.create({
      coin_type: coinType,
      bank_name: details.bankName ?? null,
      account_number: details.accountNumber ?? null,
      ifsc_code: details.ifscCode ?? null,
      account_holder_name: details.accountHolderName ?? null,
      upi_id: details.upiId ?? null,
      qr_image: qrImage ?? null,
      is_active: details.isActive ?? true,
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

    await row.update({
      ...(details.bankName !== undefined ? { bank_name: details.bankName } : {}),
      ...(details.accountNumber !== undefined ? { account_number: details.accountNumber } : {}),
      ...(details.ifscCode !== undefined ? { ifsc_code: details.ifscCode } : {}),
      ...(details.accountHolderName !== undefined ? { account_holder_name: details.accountHolderName } : {}),
      ...(details.upiId !== undefined ? { upi_id: details.upiId } : {}),
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
      hasQrImage: Boolean(row.qr_image),
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
