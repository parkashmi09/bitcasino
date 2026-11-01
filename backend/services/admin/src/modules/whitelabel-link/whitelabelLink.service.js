'use strict';

const crypto = require('crypto');
const { QueryTypes, literal } = require('sequelize');
const { money, AppError, whitelabelPlan } = require('@ibitplay/common');
const { hashPassword } = require('@ibitplay/auth');

const { addWhitelabelTopup, readOwnerDirectBalance } = require('../lords/ownerWallet');
const { PASSWORD_ROUNDS } = require('../staff/staff.constants');
const { StaffAuthService } = require('../staff-auth/staffAuth.service');

/** A preview link works once, within this long of being handed out. */
const PREVIEW_TTL_MS = 60_000;

/**
 * `credits` numeric columns that are NOT money a holder owns (limits and points), left out of the
 * "is any balance left" count a delete is warned with. Every other numeric column is a coin.
 */
const NOT_BALANCE = ['credit_limit', 'credit', 'all_point', 'upper_point', 'down_point', 'exposure_limit', 'sports_pts', 'thirdparty_pts', 'original_game_pts'];

/** The player site's palette tokens (frontend/src/theme/palettes.css `--p-*`), all required. */
const PALETTE_KEYS = Object.freeze(['bg', 's1', 's2', 's3', 'border', 'text', 'muted', 'primary', 'ink', 'accent', 'live', 'hi', 'lo']);

const noCompany = () => new AppError('This site has no company account', 409, 'WHITELABEL_NO_COMPANY');
const transferMismatch = () =>
  new AppError('This transfer id was already applied with a different amount', 409, 'WHITELABEL_TRANSFER_MISMATCH');
const badPreviewCode = () => new AppError('This preview link has expired or was already used', 401, 'WHITELABEL_PREVIEW_INVALID');

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

/**
 * The whitelabel copy's side of the link to its parent site (routes/public.routes.js).
 * The company is this site's level-1 staff row — the one the parent created with it.
 */
class WhitelabelLinkService {
  constructor({ models, db, logger, config }) {
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.config = config;
    this.staffAuth = new StaffAuthService({ models, db, logger, config });
    // shortcut: in-process codes, lost on an admin-service restart (the parent just clicks Preview again).
    this.previews = new Map();
  }

  get sequelize() {
    return this.models.Staff.sequelize;
  }

  async #query(sql, replacements = {}, transaction) {
    return this.sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });
  }

  async #company() {
    const [row] = await this.#query(
      `SELECT s.id, s.name, s.email, r.name AS role_name
         FROM staff s JOIN roles r ON r.id = s.role_id
        WHERE r.level = 1
        ORDER BY s.id
        LIMIT 1`
    );
    if (!row) throw noCompany();
    return row;
  }

  async status() {
    const [row] = await this.#query('SELECT maintenance FROM whitelabel_settings WHERE id = 1');
    return { maintenance: row?.maintenance === true };
  }

  /** The parent's custom colours for the player site, or null (the owner's template stands). */
  async theme() {
    const [row] = await this.#query('SELECT palette FROM whitelabel_settings WHERE id = 1');
    return { palette: row?.palette ?? null };
  }

  async setPalette(palette) {
    await this.#query(
      `INSERT INTO whitelabel_settings (id, palette, updated_at) VALUES (1, CAST(:palette AS JSONB), NOW())
       ON CONFLICT (id) DO UPDATE SET palette = EXCLUDED.palette, updated_at = NOW()
       RETURNING id`,
      { palette: palette ? JSON.stringify(palette) : null }
    );
    return this.theme();
  }

  /** The products and features the parent sold this copy; null = none stored (not limited). */
  async plan() {
    const [row] = await this.#query('SELECT plan FROM whitelabel_settings WHERE id = 1');
    return { plan: whitelabelPlan.cleanPlan(row?.plan) };
  }

  /**
   * Store the plan (the entitlements store reads it as a ceiling) and write the policies it
   * decides — branch management, and whitelabel always off — as the owner would.
   */
  async setPlan(plan) {
    const clean = whitelabelPlan.cleanPlan(plan);
    await this.db.transaction(async (transaction) => {
      await this.#query(
        `INSERT INTO whitelabel_settings (id, plan, updated_at) VALUES (1, CAST(:plan AS JSONB), NOW())
         ON CONFLICT (id) DO UPDATE SET plan = EXCLUDED.plan, updated_at = NOW()
         RETURNING id`,
        { plan: JSON.stringify(clean) },
        transaction
      );
      for (const [feature, variant] of Object.entries(whitelabelPlan.policiesOf(clean))) {
        await this.#query(
          `INSERT INTO site_features (feature, variant, enabled, owner_enabled, config, secrets, updated_by)
           VALUES (:feature, :variant, true, true, '{}'::jsonb, '{}'::jsonb, 'owner')
           ON CONFLICT (feature) DO UPDATE SET variant = EXCLUDED.variant, enabled = true, owner_enabled = true, updated_by = 'owner', updated_at = NOW()
           RETURNING feature`,
          { feature, variant },
          transaction
        );
      }
    });
    return this.plan();
  }

  async setMaintenance(on) {
    await this.#query(
      `INSERT INTO whitelabel_settings (id, maintenance, updated_at) VALUES (1, :on, NOW())
       ON CONFLICT (id) DO UPDATE SET maintenance = EXCLUDED.maintenance, updated_at = NOW()
       RETURNING id`,
      { on: Boolean(on) }
    );
    this.logger?.warn({ maintenance: Boolean(on) }, 'Whitelabel maintenance switched by the parent site');
    return this.status();
  }

  /** What the parent's Whitelabel panel shows on the card; everything else is read through Preview. */
  async summary() {
    const company = await this.#company();
    const [row] = await this.#query(
      `SELECT (SELECT COUNT(*) FROM staff WHERE id <> :id)::int                              AS staff,
              (SELECT COUNT(*) FROM users WHERE parent_staff_id IS NULL)::int                AS direct_users,
              (SELECT COUNT(*) FROM users WHERE parent_staff_id IS NOT NULL)::int            AS client_users,
              (SELECT COALESCE(SUM(amount), 0) FROM whitelabel_inbound_credits)              AS received,
              (SELECT COALESCE(MAX(inr), 0) FROM credits WHERE staff_id = :id)               AS agent_system,
              (SELECT COALESCE(SUM(inr), 0) FROM credits WHERE user_type = 'STAFF')          AS staff_inr,
              (SELECT COALESCE(SUM(inr), 0) FROM credits WHERE user_type = 'USER')           AS players_inr`,
      { id: company.id }
    );
    return {
      company: { id: Number(company.id), name: company.name, email: company.email, roleName: company.role_name },
      balances: {
        direct: money.fromStored(await readOwnerDirectBalance(this.models, company.id)),
        agentSystem: money.fromStored(row.agent_system),
        // INR held by agents / staff below the company, and by players.
        staff: money.fromStored(row.staff_inr),
        players: money.fromStored(row.players_inr),
      },
      counts: {
        staff: row.staff,
        directUsers: row.direct_users,
        clientUsers: row.client_users,
        // Players holding anything in ANY coin (INR included).
        playersWithBalance: await this.#playersWithBalance(),
      },
      received: money.fromStored(row.received),
      ...(await this.status()),
    };
  }

  async #playersWithBalance() {
    const columns = await this.#query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'credits' AND data_type = 'numeric'
          AND column_name NOT IN (:skip)`,
      { skip: NOT_BALANCE }
    );
    if (!columns.length) return 0;
    // Identifiers from information_schema, quoted: never user input.
    const any = columns.map((c) => `"${c.column_name.replace(/"/g, '""')}" > 0`).join(' OR ');
    const [row] = await this.#query(`SELECT COUNT(*)::int AS n FROM credits WHERE user_type = 'USER' AND (${any})`);
    return row.n;
  }

  /**
   * The parent's transfer into the company's Direct User balance. `transferId` is the parent's
   * row id: the same id again is a retry and changes nothing (`replayed: true`); the same id with
   * another amount is refused. Two concurrent calls with one id serialise on the primary key.
   */
  async credit({ transferId, amount, note }) {
    const company = await this.#company();
    const decimal = money.toDecimalString(money.toMinor(amount));

    return this.db.transaction(async (transaction) => {
      const [claimed] = await this.#query(
        `INSERT INTO whitelabel_inbound_credits (transfer_id, amount, staff_id)
         VALUES (:transferId, :amount, :staffId)
         ON CONFLICT (transfer_id) DO NOTHING
         RETURNING transfer_id`,
        { transferId, amount: decimal, staffId: company.id },
        transaction
      );

      if (!claimed) {
        const [prior] = await this.#query('SELECT amount FROM whitelabel_inbound_credits WHERE transfer_id = :transferId', { transferId }, transaction);
        if (money.toMinorQuantised(prior.amount) !== money.toMinor(decimal)) throw transferMismatch();
        const balance = money.fromStored(await readOwnerDirectBalance(this.models, company.id, { transaction }));
        return { transferId, amount: decimal, replayed: true, balance };
      }

      const result = await addWhitelabelTopup(this.models, { ownerId: company.id, amount: decimal, note }, { transaction });
      await this.#query(
        'UPDATE whitelabel_inbound_credits SET staff_transfer_id = :id WHERE transfer_id = :transferId RETURNING transfer_id',
        { id: result.transferId, transferId },
        transaction
      );
      this.logger?.warn({ transferId, amount: decimal, companyId: company.id }, 'Parent site credited the company');
      return { transferId, amount: decimal, replayed: false, balance: result.balance };
    });
  }

  /**
   * The parent resets the company's password: every company session ends, and the next sign-in
   * must choose a new one (and with it a new transaction password — staff.service changePassword).
   */
  async setCompanyPassword(password) {
    const company = await this.#company();
    await this.models.Staff.update(
      {
        password: await hashPassword(password, PASSWORD_ROUNDS),
        must_change_password: true,
        token_version: literal('token_version + 1'),
      },
      { where: { id: company.id } }
    );
    this.logger?.warn({ companyId: company.id }, 'Parent site reset the company password');
    return { companyId: Number(company.id), changed: true };
  }

  /** A one-time code for a read-only company session; the parent opens `/preview?code=` on this admin. */
  async preview() {
    const company = await this.#company();
    const now = Date.now();
    for (const [key, entry] of this.previews) if (entry.expires <= now) this.previews.delete(key);

    const code = crypto.randomBytes(24).toString('base64url');
    this.previews.set(sha256(code), { staffId: Number(company.id), expires: now + PREVIEW_TTL_MS });
    return { code, expiresInSeconds: PREVIEW_TTL_MS / 1000 };
  }

  async redeemPreview(code) {
    const key = sha256(code);
    const entry = this.previews.get(key);
    this.previews.delete(key);
    if (!entry || entry.expires <= Date.now()) throw badPreviewCode();
    return this.staffAuth.previewSession(entry.staffId);
  }
}

module.exports = { WhitelabelLinkService, PREVIEW_TTL_MS, PALETTE_KEYS };
