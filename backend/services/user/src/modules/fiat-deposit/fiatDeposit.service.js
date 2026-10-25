'use strict';

const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');

const { money, sitePolicy, currencyRegistry, manualPayments } = require('@ibitplay/common');
const { Op: SequelizeOp } = require('@ibitplay/db');
const { assertPlayerCapability } = require('@ibitplay/auth');

const errors = require('./fiatDeposit.errors');

/** The ledger line for an approved manual deposit: crypto names its coin, network and tx hash. */
const depositDescription = (deposit, depositId) =>
  deposit.network
    ? `Crypto deposit ${deposit.currency}·${deposit.network} #${depositId} (${deposit.transaction_id})`
    : `Fiat deposit #${depositId} approved`;
const {
  DEPOSIT_STATUS,
  MAGIC_BYTES,
  MAX_SCREENSHOT_BYTES,
} = require('./fiatDeposit.constants');
const { WalletService } = require('../wallet/wallet.service');
const { REASON } = require('../wallet/wallet.constants');
const { FirstDepositBonusService } = require('../bonus/firstDepositBonus.service');
const { notifyPlayer } = require('../notifications/notifyPlayer');
const { withChannel, assertPlayerVisible } = require('../directory/playerScope');

/**
 * Manual fiat deposits — a player transfers money to the house's bank account,
 * uploads proof, and an operator approves it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * What this replaces, and why it could not have been working
 *
 * `legacy/fiatdeposit/controller.js` used TWO DIFFERENT TABLES for one flow:
 *
 *   createDeposit       INSERT INTO fiat_deposits     (line 52)
 *   getUserDeposits     SELECT * FROM deposits        (line 117)
 *   getDepositById      SELECT * FROM deposits        (line 134)
 *   getAllDeposits      FROM deposits                 (line 168)
 *   getPendingDeposits  FROM deposits                 (line 185)
 *   approveDeposit      UPDATE deposits               (line 206)
 *   rejectDeposit       UPDATE deposits               (line 242)
 *
 * `deposits` is the CRYPTO deposit table. Its columns are
 * `uid, date, status, txtid, amount, coin, salt, id` — verified against the
 * live schema. The queries above reference `user_id`, `created_at`,
 * `approved_at` and `rejected_at`, none of which exist on it.
 *
 * So a fiat deposit was written to `fiat_deposits` and then looked for in
 * `deposits`, where it never was — and the lookup would have errored on the
 * missing columns before it could fail to find anything. Six endpoints, none of
 * which could ever have returned successfully.
 *
 * There is a second, quieter defect. `approveDeposit` credited:
 *
 *   UPDATE users SET balance = balance + $1 WHERE id = $2
 *
 * `users.balance` is written in exactly one place in the entire legacy codebase
 * — that line. Every game, every bet and the withdrawal path read
 * `credits.<currency>`, which is written in eighteen. So even had the approval
 * found the row, the money would have landed in a column the player cannot
 * spend, bet or withdraw.
 *
 * Here the whole flow is on `fiat_deposits`, and the credit goes through
 * `WalletService`, so it takes the row lock, writes the ledger and carries an
 * idempotency key derived from the deposit id.
 * ─────────────────────────────────────────────────────────────────────────
 */
class FiatDepositService {
  constructor(deps) {
    const { models, db, config, logger } = deps;
    this.models = models;
    this.db = db;
    this.config = config;
    this.logger = logger;
    this.wallet = new WalletService(deps);
    this.firstDepositBonus = deps.firstDepositBonus ?? new FirstDepositBonusService(deps);
    this.storageDir = config.DEPOSIT_STORAGE_DIR;
  }

  /**
   * Lodge a deposit for review.
   *
   * @legacy POST /api/deposits/create
   * @legacy POST /api/deposit/create
   */
  async create({ userId, details, screenshot }) {
    // Before anything is written: a refused submission must leave no file behind.
    await sitePolicy.assertAllowed(this.models, 'deposit_mode', 'manual', this.logger);
    // Super Admin ka Manual deposit switch (Admin → Transactions → Deposit → Manual).
    await manualPayments.assertManualAllowed(this.models.Users?.sequelize, 'deposit');
    // The coin registry (061): no deposit in a coin the owner or the site switched off.
    await currencyRegistry.assertCurrencyEnabled(details.currency);
    // A crypto coin is a manual on-chain transfer: the network is required and the tx hash
    // (`transactionId`) is the proof, so a screenshot is optional.
    const isCrypto = (await currencyRegistry.describe(details.currency))?.kind === 'crypto';
    if (isCrypto) {
      if (!details.network) throw errors.NETWORK_REQUIRED();
      const networks = (await currencyRegistry.networksOf(details.currency)) ?? [];
      if (!networks.some((n) => n.key === details.network)) {
        throw errors.NETWORK_NOT_ENABLED({ currency: details.currency, network: details.network });
      }
    } else if (!screenshot) {
      throw errors.SCREENSHOT_REQUIRED();
    }

    // A bank reference identifies one real transfer. Two deposits claiming the
    // same one is either a double submission or an attempt to be credited twice
    // for a single payment; legacy checked neither.
    const duplicate = await this.models.FiatDeposits.findOne({
      where: { transaction_id: details.transactionId },
      raw: true,
    });
    if (duplicate) throw errors.DUPLICATE_TRANSACTION({ transactionId: details.transactionId });

    const storedFile = screenshot ? await this.#storeScreenshot(userId, screenshot) : null;

    const row = await this.models.FiatDeposits.create({
      user_id: userId,
      amount: details.amount,
      claimed_amount: details.amount,
      currency: details.currency,
      transaction_id: details.transactionId,
      bank_name: details.bankName ?? null,
      account_number: details.accountNumber ?? null,
      ifsc_code: details.ifscCode ?? null,
      account_holder_name: details.accountHolderName ?? null,
      upi_id: details.upiId ?? null,
      network: isCrypto ? details.network : null,
      wallet_address: isCrypto ? details.walletAddress ?? null : null,
      screenshot_path: storedFile,
      status: DEPOSIT_STATUS.PENDING,
    });

    this.logger?.info(
      { userId, depositId: row.deposit_id, amount: details.amount, currency: details.currency },
      'Fiat deposit lodged for review'
    );

    return this.#present(row.get({ plain: true }));
  }

  /** @legacy GET /api/deposits/user-deposits */
  async listForUser({ userId, status, limit, offset }) {
    const result = await this.models.FiatDeposits.findAndCountAll({
      where: { user_id: userId, ...(status ? { status } : {}) },
      order: [['deposit_id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    return { count: result.count, rows: result.rows.map((r) => this.#present(r)) };
  }

  /** @legacy GET /api/deposits/deposit/:depositId */
  async getForUser({ depositId, userId }) {
    const row = await this.models.FiatDeposits.findOne({
      where: { deposit_id: depositId, user_id: userId },
      raw: true,
    });
    if (!row) throw errors.NOT_FOUND({ depositId });
    if (row.status !== DEPOSIT_STATUS.APPROVED) return this.#present(row);

    /* What was actually CREDITED, which the operator may have corrected from the
       claimed `amount` (approve's `creditAmount`). The row does not keep it; the
       ledger does, under the idempotency key approve writes. The wallet's
       "Approved — ₹X added" reads this one. */
    const ledger = await this.models.CreditsLedger.findOne({
      where: { idempotency_key: `fiat-deposit:${depositId}`, user_id: String(userId) },
      attributes: ['amount'],
      raw: true,
    });
    return {
      ...this.#present(row),
      creditedAmount: ledger ? money.toDecimalString(money.toMinor(ledger.amount)) : null,
    };
  }

  /**
   * @legacy GET /api/deposits/admin/all-deposits
   * @legacy GET /api/deposit/user/history/:username
   * @legacy GET /api/deposit/admin/:staffId
   */
  async listAll({ status, userId, currency, search, channel, limit, offset }) {
    const where = withChannel({
      ...(status ? { status } : {}),
      ...(userId ? { user_id: userId } : {}),
      ...(currency ? { currency } : {}),
      ...(search
        ? {
            [SequelizeOp.or]: [
              { transaction_id: { [SequelizeOp.iLike]: `%${search}%` } },
              { account_holder_name: { [SequelizeOp.iLike]: `%${search}%` } },
              { upi_id: { [SequelizeOp.iLike]: `%${search}%` } },
            ],
          }
        : {}),
    }, 'user_id', channel);

    const result = await this.models.FiatDeposits.findAndCountAll({
      where,
      order: [['deposit_id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    const ids = [...new Set(result.rows.map((r) => r.user_id).filter(Boolean).map(String))];
    const users = ids.length
      ? await this.models.Users.findAll({ attributes: ['id', 'name', 'avatar'], where: { id: { [SequelizeOp.in]: ids } }, raw: true })
      : [];
    const byId = new Map(users.map((u) => [String(u.id), u]));

    return {
      count: result.count,
      rows: result.rows.map((r) => ({
        ...this.#present(r, { forStaff: true }),
        username: byId.get(String(r.user_id))?.name || String(r.user_id),
        avatar: byId.get(String(r.user_id))?.avatar ?? null,
      })),
    };
  }

  /**
   * @legacy GET /api/deposits/admin/pending-deposits
   * @legacy GET /api/deposit/admin/pending
   */
  async listPending({ limit, offset }) {
    return this.listAll({ status: DEPOSIT_STATUS.PENDING, limit, offset });
  }

  /**
   * Approve a deposit and credit the player.
   *
   * @legacy PUT /api/deposits/admin/approve/:depositId
   * @legacy PUT /api/deposit/admin/approve/:id
   *
   * The status flip and the credit are one transaction, and the status guard
   * (`status = 'pending'`) is what makes a double-click safe: the second
   * approval finds no pending row and stops before any money moves. The wallet
   * call also carries `deposit:<id>` as its idempotency key, so even a retry
   * that somehow reached the credit would collapse onto the first.
   */
  async approve({ depositId, creditAmount, comment }, staff) {
    const approved = await this.db.transaction(async (transaction) => {
      const deposit = await this.models.FiatDeposits.findOne({
        where: { deposit_id: depositId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!deposit) throw errors.NOT_FOUND({ depositId });
      if (deposit.status !== DEPOSIT_STATUS.PENDING) {
        throw errors.ALREADY_PROCESSED({ depositId, status: deposit.status });
      }
      // Manual deposit sirf direct user ka — child user (koi parent) ka paisa Sports Exchange D/W se.
      await assertPlayerCapability(deposit.user_id, 'deposit');

      // Normalised either way, so the response and the ledger always carry a
      // canonical 8-dp string rather than whatever the operator typed.
      const amount = money.toDecimalString(money.toMinor(creditAmount ?? deposit.amount));
      const claimed = money.toDecimalString(money.toMinor(deposit.amount));
      // Never more than the player deposited; less (the bank statement shows less) only with the
      // reason the player sees.
      if (money.gt(amount, claimed)) throw errors.CREDIT_ABOVE_CLAIMED({ claimed, credit: amount });
      if (money.lt(amount, claimed) && !String(comment ?? '').trim()) throw errors.CREDIT_REASON_REQUIRED({ claimed, credit: amount });

      await deposit.update(
        {
          status: DEPOSIT_STATUS.APPROVED,
          // What was credited; the claim stays in claimed_amount (migration 114), so every
          // sum of approved deposits (rollover, withdrawal cap, reports) counts real money.
          amount,
          claimed_amount: claimed,
          admin_comment: comment ?? null,
          handled_by: staff?.id ?? null,
          handled_at: new Date(),
        },
        { transaction }
      );

      // Through the wallet, so this lands in `credits.<currency>` with a ledger
      // row — not in `users.balance`, which nothing spends from.
      const movement = await this.wallet.credit(
        {
          userId: deposit.user_id,
          currency: deposit.currency,
          amount,
          reason: REASON.DEPOSIT,
          idempotencyKey: `fiat-deposit:${depositId}`,
          refType: 'FIAT_DEPOSIT',
          refId: String(depositId),
          description: depositDescription(deposit, depositId),
        },
        { sourceService: 'user-service', transaction }
      );

      this.logger?.info(
        { depositId, userId: deposit.user_id, amount, staffId: staff?.id, ledgerId: movement.ledgerId },
        'Fiat deposit approved and credited'
      );

      return {
        depositId,
        userId: deposit.user_id,
        currency: deposit.currency,
        creditedAmount: amount,
        claimedAmount: claimed,
        newBalance: movement.newBalance,
        ledgerId: movement.ledgerId,
      };
    });

    // After COMMIT, outside the approval: the bonus never fails the deposit.
    const firstDepositBonus = await this.firstDepositBonus.onDepositCredited({
      userId: approved.userId,
      currency: approved.currency,
      amount: approved.creditedAmount,
      ledgerId: approved.ledgerId,
      source: 'FIAT_DEPOSIT',
      refId: String(depositId),
    });
    void notifyPlayer(approved.userId, {
      kind: 'deposit_approved',
      key: `fiat-deposit:approved:${depositId}`,
      title: 'Deposit approved',
      body: `{amount} has been added to your wallet (deposit #${depositId}).`,
      link: '#transactions',
      meta: { amount: approved.creditedAmount, currency: approved.currency, depositId },
    });
    return { ...approved, firstDepositBonus };
  }

  /**
   * @legacy PUT /api/deposits/admin/reject/:depositId
   * @legacy PUT /api/deposit/admin/reject/:id
   */
  async reject({ depositId, comment }, staff) {
    if (!comment) throw errors.REJECTION_REASON_REQUIRED();

    const deposit = await this.models.FiatDeposits.findOne({ where: { deposit_id: depositId } });
    if (!deposit) throw errors.NOT_FOUND({ depositId });
    if (deposit.status !== DEPOSIT_STATUS.PENDING) {
      throw errors.ALREADY_PROCESSED({ depositId, status: deposit.status });
    }

    await deposit.update({
      status: DEPOSIT_STATUS.REJECTED,
      admin_comment: comment,
      handled_by: staff?.id ?? null,
      handled_at: new Date(),
    });

    this.logger?.info({ depositId, staffId: staff?.id }, 'Fiat deposit rejected');
    void notifyPlayer(deposit.user_id, {
      kind: 'deposit_rejected',
      key: `fiat-deposit:rejected:${depositId}`,
      title: 'Deposit rejected',
      body: `Your {amount} deposit #${depositId} was rejected. Reason: ${comment}`,
      link: '#transactions',
      meta: { amount: deposit.amount, currency: deposit.currency, depositId, reason: comment },
    });
    return { depositId, status: DEPOSIT_STATUS.REJECTED, comment };
  }

  /**
   * Read the proof-of-payment file.
   *
   * @legacy GET /api/deposits/screenshot/:depositId
   * @legacy GET /api/deposit/:staff_id(\\d+)?/:id/screenshot
   *
   * Ownership is checked here, and the resolved path is verified to sit inside
   * the storage directory before anything is read.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * LEGACY AUTHORISED THE URL, NOT THE CALLER
   *
   *     const rawSid  = req.params.staff_id;          // may be undefined
   *     const staffId = Number(rawSid);
   *     const staffMode = Number.isInteger(staffId) && staffId > 0;
   *     …
   *     if (staffMode) {
   *       await assertInHierarchy(staffId, dep.user_id);
   *     }
   *
   * `staffId` comes from the PATH. The check asks whether the staff id in the
   * URL is entitled to the deposit — not whether the person making the request
   * is that staff member. Anyone could name a staff id that legitimately owns
   * the deposit and be handed the file. The whole `/api/deposit` router carries
   * no authentication middleware, so there was no token to check against
   * anyway; the same router is where `PUT /admin/approve/:id` sits, already
   * reported in an earlier batch.
   *
   * A deposit screenshot is a photograph of a bank transfer: the depositor's
   * name, their account number and the amount. Deposit ids are sequential.
   *
   * Here `requesterId` comes from the verified token and `isStaff` from the
   * guard the module loader attached, so the identity being authorised is the
   * one that made the request.
   * ═══════════════════════════════════════════════════════════════════════
   */
  async readScreenshot({ depositId, requesterId, isStaff }) {
    const row = await this.models.FiatDeposits.findOne({
      where: { deposit_id: depositId },
      raw: true,
    });
    if (!row) throw errors.SCREENSHOT_NOT_FOUND({ depositId });

    if (isStaff) {
      // A staff reader opens only their own tree's receipts (as KYC documents); out of tree reads
      // exactly like missing.
      try {
        await assertPlayerVisible(this, requesterId, row.user_id);
      } catch (error) {
        if (error?.status === 404) throw errors.SCREENSHOT_NOT_FOUND({ depositId });
        throw error;
      }
    }

    if (!isStaff && Number(row.user_id) !== Number(requesterId)) {
      // Same error as absent: confirming it exists would leak that a deposit
      // with this id belongs to someone.
      throw errors.SCREENSHOT_NOT_FOUND({ depositId });
    }
    if (!row.screenshot_path) throw errors.SCREENSHOT_NOT_FOUND({ depositId });

    const root = path.resolve(this.storageDir);
    const fullPath = path.resolve(root, row.screenshot_path);
    if (!fullPath.startsWith(root + path.sep)) {
      this.logger?.error({ depositId, stored: row.screenshot_path }, 'Refused a path outside deposit storage');
      throw errors.SCREENSHOT_NOT_FOUND({ depositId });
    }

    try {
      const buffer = await fs.readFile(fullPath);
      return { buffer, contentType: this.#contentTypeOf(fullPath), filename: path.basename(fullPath) };
    } catch {
      throw errors.SCREENSHOT_NOT_FOUND({ depositId });
    }
  }

  // ══════════════════════════════════════════════════════════════════════

  async #storeScreenshot(userId, file) {
    if (file.size > MAX_SCREENSHOT_BYTES) throw errors.SCREENSHOT_TOO_LARGE({ size: file.size });

    const detected = this.#sniff(file.buffer);
    if (!detected) throw errors.INVALID_SCREENSHOT({ declared: file.mimetype });

    const extension = { 'image/jpeg': '.jpg', 'image/png': '.png', 'application/pdf': '.pdf' }[detected];
    // Random, not `deposit_${Date.now()}` — legacy's name was guessable, and
    // the file is a bank transfer receipt.
    const filename = `${userId}-${crypto.randomBytes(16).toString('hex')}${extension}`;

    await fs.mkdir(this.storageDir, { recursive: true });
    await fs.writeFile(path.join(this.storageDir, filename), file.buffer, { mode: 0o600 });

    return filename;
  }

  #sniff(buffer) {
    if (!buffer || buffer.length < 4) return null;
    for (const { mime, bytes } of MAGIC_BYTES) {
      if (bytes.every((byte, i) => buffer[i] === byte)) return mime;
    }
    return null;
  }

  #contentTypeOf(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.png') return 'image/png';
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.pdf') return 'application/pdf';
    return 'application/octet-stream';
  }

  /** The screenshot PATH is never returned — only whether one exists. */
  #present(row, { forStaff = false } = {}) {
    return {
      depositId: row.deposit_id,
      userId: row.user_id,
      // Credited once approved; claimedAmount is what the player entered (migration 114).
      amount: money.toDecimalString(money.toMinor(row.amount ?? '0')),
      claimedAmount: money.toDecimalString(money.toMinorQuantised(String(row.claimed_amount ?? row.amount ?? '0'))),
      currency: row.currency,
      transactionId: row.transaction_id,
      bankName: row.bank_name,
      accountHolderName: row.account_holder_name,
      upiId: row.upi_id,
      network: row.network ?? null,
      walletAddress: row.wallet_address ?? null,
      status: row.status,
      hasScreenshot: Boolean(row.screenshot_path),
      adminComment: row.admin_comment,
      createdAt: row.created_at,
      ...(forStaff
        ? {
            accountNumber: row.account_number,
            ifscCode: row.ifsc_code,
            handledBy: row.handled_by,
            handledAt: row.handled_at,
          }
        : {}),
    };
  }
}

module.exports = { FiatDepositService, depositDescription };
