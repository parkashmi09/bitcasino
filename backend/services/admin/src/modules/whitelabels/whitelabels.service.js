'use strict';

const crypto = require('crypto');
const { QueryTypes } = require('sequelize');
const { money, imageUpload } = require('@ibitplay/common');
const { hashPassword, createSecretBox } = require('@ibitplay/auth');

const errors = require('./whitelabels.errors');
const { createLinkClient } = require('./linkClient');
const { imageProblem } = require('../branding/branding.rules');
const { PASSWORD_ROUNDS } = require('../staff/staff.constants');
const { assertTransactionPassword } = require('../staff-auth/transactionPassword');
const { TRANSFER_TYPE } = require('../lords/lords.constants');
const {
  LEDGER_TYPE,
  debitOwnerDirectBalance,
  creditOwnerDirectBalance,
  insufficientDirectBalance,
} = require('../lords/ownerWallet');

/** A pending transfer this old is sent again when its whitelabel is opened (the first try has had its time). */
const RETRY_AFTER_MS = 15_000;
const EXT = { 'image/png': 'png', 'image/webp': 'webp', 'image/svg+xml': 'svg' };

/**
 * A stored amount ("10000.00000000", the platform's scale) as the link sends it: 2 decimals, the
 * copy's rule. Exact: the panel takes at most 2 decimals, so only zeros are dropped.
 */
function twoDecimals(stored) {
  const [whole, fraction = ''] = money.fromStored(stored).split('.');
  return `${whole}.${`${fraction}00`.slice(0, 2)}`;
}

/** base64 → bytes, checked like any branding upload (`slot` sets the size limit); null when absent. */
function decodeImage(input, slot) {
  if (!input) return null;
  const bytes = Buffer.from(input.data, 'base64');
  if (imageProblem(bytes, `${slot}.${EXT[input.type]}`, slot)) throw slot === 'logo' ? errors.BAD_LOGO() : errors.BAD_ICON();
  return bytes;
}

const POSTER_MAX_BYTES = 600 * 1024;
const PLACEMENT = { poster: 'home', poster_mobile: 'home_mobile' };

/** A poster's bytes, checked by signature (PNG / JPEG / WebP) and size; null when absent. */
function decodePoster(input) {
  if (!input) return null;
  const bytes = Buffer.from(input.data, 'base64');
  const sniffed = imageUpload.sniff(bytes);
  if (bytes.length < 64 || bytes.length > POSTER_MAX_BYTES || !sniffed || sniffed.contentType !== input.type) throw errors.BAD_POSTER();
  return bytes;
}

/** What the panel may see of a row: never the link key, the password hash or the logo bytes. */
function view(r) {
  return {
    id: Number(r.id),
    slug: r.slug,
    name: r.name,
    title: r.title,
    description: r.description,
    siteDomain: r.site_domain,
    adminDomain: r.admin_domain,
    apiDomain: r.api_domain,
    template: r.template,
    palette: r.palette ?? null,
    hasLogo: Boolean(r.logo_type),
    hasIcon: Boolean(r.icon_type),
    companyRoleName: r.company_role_name,
    companyName: r.company_name,
    companyEmail: r.company_email,
    status: r.status,
    maintenance: r.maintenance === true,
    ports: r.ports ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const transferView = (t) => ({
  id: String(t.id),
  amount: money.fromStored(t.amount),
  note: t.note,
  status: t.status,
  uncertain: t.uncertain === true,
  attempts: Number(t.attempts),
  error: t.error,
  createdAt: t.created_at,
  updatedAt: t.updated_at,
});

/**
 * The PARENT site's Whitelabel panel (routes/admin.routes.js). A whitelabel is a full copy of this
 * stack set up by the setup script (scripts/whitelabel/) from a `whitelabel_jobs` row; once it is
 * live, everything here talks to it over its link (admin modules/whitelabel-link on the copy).
 */
class WhitelabelsService {
  constructor({ models, db, logger, config, fetchImpl }) {
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.config = config;
    this.secrets = createSecretBox({ config, logger });
    this.link = createLinkClient({ secrets: this.secrets, fetchImpl });
  }

  get sequelize() {
    return this.models.Staff.sequelize;
  }

  #q(sql, replacements = {}, transaction) {
    return this.sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });
  }

  async #row(id, transaction) {
    const [row] = await this.#q('SELECT * FROM whitelabels WHERE id = :id', { id }, transaction);
    if (!row || row.status === 'deleted') throw errors.NOT_FOUND({ id });
    return row;
  }

  async #live(id) {
    const row = await this.#row(id);
    if (row.status !== 'live') throw errors.NOT_LIVE({ status: row.status });
    return row;
  }

  async list({ limit, offset, search, status }) {
    const where = [status ? 'w.status = :status' : "w.status <> 'deleted'"];
    if (search) where.push('(w.name ILIKE :like OR w.slug ILIKE :like OR w.site_domain ILIKE :like)');
    const filter = where.join(' AND ');
    const replacements = { status: status ?? null, like: `%${search ?? ''}%`, limit, offset };
    const rows = await this.#q(`SELECT w.* FROM whitelabels w WHERE ${filter} ORDER BY w.id DESC LIMIT :limit OFFSET :offset`, replacements);
    const [{ total }] = await this.#q(`SELECT COUNT(*)::int AS total FROM whitelabels w WHERE ${filter}`, replacements);
    return { rows: rows.map(view), total };
  }

  async create(input, actor) {
    const domains = [input.siteDomain, input.adminDomain, input.apiDomain];
    if (new Set(domains).size !== 3) throw errors.SAME_DOMAIN();

    const [clash] = await this.#q(
      `SELECT id FROM whitelabels
        WHERE status <> 'deleted'
          AND (LOWER(slug) = :slug OR LOWER(site_domain) IN (:domains) OR LOWER(admin_domain) IN (:domains) OR LOWER(api_domain) IN (:domains))
        LIMIT 1`,
      { slug: input.slug, domains }
    );
    if (clash) throw errors.TAKEN();

    const logo = decodeImage(input.logo, 'logo');
    const icon = decodeImage(input.icon, 'mark');
    const posters = { poster: decodePoster(input.poster), poster_mobile: decodePoster(input.posterMobile) };
    const posterTypes = { poster: input.poster?.type, poster_mobile: input.posterMobile?.type };

    const row = await this.db.transaction(async (transaction) => {
      let created;
      try {
        [created] = await this.#q(
          `INSERT INTO whitelabels
             (slug, name, title, description, site_domain, admin_domain, api_domain, template, palette, logo, logo_type,
              icon, icon_type, company_role_name, company_name, company_email, company_password_hash, link_key, created_by)
           VALUES (:slug, :name, :title, :description, :siteDomain, :adminDomain, :apiDomain, :template, CAST(:palette AS JSONB),
              :logo, :logoType, :icon, :iconType, :companyRoleName, :companyName, :companyEmail, :passwordHash, :linkKey, :actorId)
           RETURNING *`,
          {
            ...input,
            title: input.title || null,
            description: input.description || null,
            palette: input.palette ? JSON.stringify(input.palette) : null,
            logo,
            logoType: input.logo?.type ?? null,
            icon,
            iconType: input.icon?.type ?? null,
            passwordHash: await hashPassword(input.companyPassword, PASSWORD_ROUNDS),
            linkKey: this.secrets.seal(crypto.randomBytes(32).toString('hex')),
            actorId: actor.id,
          },
          transaction
        );
      } catch (error) {
        // Two creates racing past the check above: the partial unique indexes decide.
        if (error.name === 'SequelizeUniqueConstraintError') throw errors.TAKEN();
        throw error;
      }
      for (const [slot, bytes] of Object.entries(posters)) {
        if (bytes) await this.#savePoster(created.id, slot, posterTypes[slot], bytes, transaction);
      }
      await this.#enqueue(created.id, 'create', actor, transaction);
      return created;
    });

    this.logger?.warn({ whitelabelId: row.id, slug: row.slug, actorStaffId: actor.id }, 'Whitelabel queued for setup');
    return view(row);
  }

  async #enqueue(whitelabelId, kind, actor, transaction) {
    await this.#q(
      `INSERT INTO whitelabel_jobs (whitelabel_id, kind, created_by) VALUES (:whitelabelId, :kind, :actorId) RETURNING id`,
      { whitelabelId, kind, actorId: actor.id },
      transaction
    );
  }

  /** One whitelabel: its row, its latest jobs and transfers, and (live) the copy's own figures. */
  async detail(id) {
    let row = await this.#row(id);
    let summary = null;
    let summaryError = null;
    if (row.status === 'live') {
      await this.#retryPending(row, RETRY_AFTER_MS);
      try {
        summary = await this.link(row, 'GET', '/summary');
      } catch (error) {
        summaryError = error.message;
      }
      row = await this.#row(id);
    }
    const jobs = await this.#q(
      `SELECT id, kind, status, step, log, created_at, started_at, finished_at
         FROM whitelabel_jobs WHERE whitelabel_id = :id ORDER BY id DESC LIMIT 5`,
      { id }
    );
    const transfers = await this.#q('SELECT * FROM whitelabel_transfers WHERE whitelabel_id = :id ORDER BY id DESC LIMIT 25', { id });
    return {
      ...view(row),
      posters: await this.posters(id),
      summary,
      summaryError,
      jobs: jobs.map((j) => ({
        id: j.id,
        kind: j.kind,
        status: j.status,
        step: j.step,
        log: j.log,
        createdAt: j.created_at,
        startedAt: j.started_at,
        finishedAt: j.finished_at,
      })),
      transfers: transfers.map(transferView),
    };
  }

  /** `which` = 'logo' | 'icon': the image the whitelabel was created or last updated with. */
  async image(id, which) {
    const column = which === 'icon' ? 'icon' : 'logo'; // a fixed name, never input
    const [row] = await this.#q(`SELECT ${column} AS data, ${column}_type AS type FROM whitelabels WHERE id = :id AND status <> 'deleted'`, { id });
    if (!row?.data || !row.type) throw errors.NOT_FOUND({ id });
    return { data: row.data, contentType: row.type };
  }

  #savePoster(id, slot, type, bytes, transaction) {
    return this.#q(
      `INSERT INTO whitelabel_assets (whitelabel_id, slot, content_type, bytes) VALUES (:id, :slot, :type, :bytes)
       ON CONFLICT (whitelabel_id, slot) DO UPDATE SET content_type = EXCLUDED.content_type, bytes = EXCLUDED.bytes, updated_at = NOW()
       RETURNING slot`,
      { id, slot, type, bytes },
      transaction
    );
  }

  async posterImage(id, which) {
    const [row] = await this.#q('SELECT content_type, bytes FROM whitelabel_assets WHERE whitelabel_id = :id AND slot = :which', { id, which });
    if (!row) throw errors.NOT_FOUND({ id });
    return { data: row.bytes, contentType: row.content_type };
  }

  async posters(id) {
    const rows = await this.#q('SELECT slot, updated_at FROM whitelabel_assets WHERE whitelabel_id = :id', { id });
    return Object.fromEntries(rows.map((r) => [r.slot, r.updated_at]));
  }

  /** New home-page poster(s): kept here (a setup run again uses them) and, when live, put on the copy. */
  async setPoster(id, { desktop, mobile }) {
    const row = await this.#row(id);
    if (['creating', 'deleting'].includes(row.status)) throw errors.BUSY({ status: row.status });
    const given = { poster: desktop, poster_mobile: mobile };
    const bytes = Object.fromEntries(Object.entries(given).map(([slot, input]) => [slot, decodePoster(input)]));
    for (const [slot, input] of Object.entries(given)) {
      if (!input) continue;
      if (row.status === 'live') await this.link(row, 'PUT', '/poster', { placement: PLACEMENT[slot], type: input.type, data: input.data });
      await this.#savePoster(id, slot, input.type, bytes[slot]);
    }
    return { posters: await this.posters(id) };
  }

  /**
   * A new logo and / or icon. Kept here (a setup run again uses them) and, when live, put on the
   * copy at once through its branding store (the icon is the copy's "mark" slot: favicon and the
   * small icons). A copy with no icon of its own shows the logo there too, so a new logo also
   * goes to the mark slot then.
   */
  async setBranding(id, { logo, icon }) {
    const row = await this.#row(id);
    if (['creating', 'deleting'].includes(row.status)) throw errors.BUSY({ status: row.status });
    const logoBytes = decodeImage(logo, 'logo');
    const iconBytes = decodeImage(icon, 'mark');

    if (row.status === 'live') {
      if (logo) await this.link(row, 'PUT', '/branding', { slot: 'logo', type: logo.type, data: logo.data });
      const mark = icon ?? (logo && !row.icon_type ? logo : null);
      if (mark) await this.link(row, 'PUT', '/branding', { slot: 'mark', type: mark.type, data: mark.data });
    }
    await this.#q(
      `UPDATE whitelabels
          SET logo = COALESCE(:logo, logo), logo_type = COALESCE(:logoType, logo_type),
              icon = COALESCE(:icon, icon), icon_type = COALESCE(:iconType, icon_type), updated_at = NOW()
        WHERE id = :id RETURNING id`,
      { id, logo: logoBytes, logoType: logo?.type ?? null, icon: iconBytes, iconType: icon?.type ?? null }
    );
    return view(await this.#row(id));
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Money: the Super Admin's Direct balance → the company's Direct balance
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Debit here first and record the transfer `pending` (one transaction), then deliver it. The copy
   * applies `p<id>` once however often it arrives, so delivery can always be retried; the money is
   * given back here only when the copy refused it AND no earlier attempt went unanswered.
   */
  async transfer({ id, amount, note, transactionPassword, actor }) {
    const row = await this.#live(id);
    await assertTransactionPassword(this.models, actor.id, transactionPassword, { required: true, executiveId: actor.executiveId ?? null });
    const decimal = money.toDecimalString(money.toMinor(amount));

    const transfer = await this.db.transaction(async (transaction) => {
      const debited = await debitOwnerDirectBalance(this.models, actor.id, decimal, {
        transaction,
        entry: { type: LEDGER_TYPE.TO_WHITELABEL, note: `To whitelabel ${row.name}${note ? ` — ${note}` : ''}` },
      });
      if (!debited) throw insufficientDirectBalance({ required: decimal });

      const staffTransfer = await this.models.StaffTransfers.create(
        {
          from_type: 'staff',
          from_id: actor.id,
          to_type: 'whitelabel',
          to_id: row.id,
          amount: decimal,
          direction: 'deposit',
          transfer_type: TRANSFER_TYPE.TO_WHITELABEL,
          note: note ?? `To whitelabel ${row.name}`,
          created_at: new Date(),
        },
        { transaction }
      );
      const [created] = await this.#q(
        `INSERT INTO whitelabel_transfers (whitelabel_id, amount, note, staff_id, staff_transfer_id)
         VALUES (:wl, :amount, :note, :staffId, :staffTransferId) RETURNING *`,
        { wl: row.id, amount: decimal, note: note ?? null, staffId: actor.id, staffTransferId: staffTransfer.id },
        transaction
      );
      return created;
    });

    this.logger?.warn({ whitelabelId: row.id, transferId: transfer.id, amount: decimal, actorStaffId: actor.id }, 'Whitelabel transfer debited');
    return transferView(await this.#deliver(row, transfer));
  }

  async #deliver(row, transfer) {
    try {
      await this.link(row, 'POST', '/credit', {
        transferId: `p${transfer.id}`,
        amount: twoDecimals(transfer.amount),
        ...(transfer.note ? { note: transfer.note } : {}),
      });
      const [done] = await this.#q(
        `UPDATE whitelabel_transfers SET status = 'done', attempts = attempts + 1, error = NULL, updated_at = NOW()
          WHERE id = :id AND status = 'pending' RETURNING *`,
        { id: transfer.id }
      );
      return done ?? transfer;
    } catch (error) {
      const refused = error.code === 'WHITELABEL_LINK_REFUSED';
      if (refused && !transfer.uncertain) return this.#refund(row, transfer, error.message);
      const [kept] = await this.#q(
        `UPDATE whitelabel_transfers
            SET attempts = attempts + 1, error = :error, uncertain = uncertain OR :unanswered, updated_at = NOW()
          WHERE id = :id AND status = 'pending' RETURNING *`,
        { id: transfer.id, error: String(error.message).slice(0, 500), unanswered: !refused }
      );
      this.logger?.warn({ whitelabelId: row.id, transferId: transfer.id, err: error.message }, 'Whitelabel transfer not delivered yet');
      return kept ?? transfer;
    }
  }

  /** The copy refused a transfer no earlier attempt could have applied: give it back, once. */
  async #refund(row, transfer, reason) {
    return this.db.transaction(async (transaction) => {
      const [claimed] = await this.#q(
        `UPDATE whitelabel_transfers SET status = 'refunded', attempts = attempts + 1, error = :reason, updated_at = NOW()
          WHERE id = :id AND status = 'pending' AND uncertain = false RETURNING *`,
        { id: transfer.id, reason: String(reason).slice(0, 500) },
        transaction
      );
      if (!claimed) return transfer;
      await creditOwnerDirectBalance(this.models, claimed.staff_id, money.fromStored(claimed.amount), {
        transaction,
        entry: { type: LEDGER_TYPE.WHITELABEL_REFUND, note: `Refused by whitelabel ${row.name}` },
      });
      await this.models.StaffTransfers.create(
        {
          from_type: 'whitelabel',
          from_id: row.id,
          to_type: 'staff',
          to_id: claimed.staff_id,
          amount: money.fromStored(claimed.amount),
          direction: 'deposit',
          transfer_type: TRANSFER_TYPE.WHITELABEL_REFUND,
          note: `Refused by whitelabel ${row.name}`,
          created_at: new Date(),
        },
        { transaction }
      );
      this.logger?.warn({ whitelabelId: row.id, transferId: transfer.id, reason }, 'Whitelabel transfer refunded');
      return claimed;
    });
  }

  async #retryPending(row, olderThanMs) {
    const pending = await this.#q(
      `SELECT * FROM whitelabel_transfers
        WHERE whitelabel_id = :id AND status = 'pending' AND updated_at < NOW() - make_interval(secs => :secs)
        ORDER BY id`,
      { id: row.id, secs: olderThanMs / 1000 }
    );
    for (const transfer of pending) await this.#deliver(row, transfer);
    return pending.length;
  }

  /** "Send again" on the panel: every pending transfer of this whitelabel, now. */
  async retryTransfers(id) {
    const row = await this.#live(id);
    return { retried: await this.#retryPending(row, 0) };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Company login, on/off, colours, preview
  // ══════════════════════════════════════════════════════════════════════

  async setCompanyPassword(id, password) {
    const row = await this.#row(id);
    if (row.status === 'live') return this.link(row, 'POST', '/company-password', { password });
    if (!['queued', 'failed'].includes(row.status)) throw errors.BUSY({ status: row.status });
    // Not set up yet: the setup script will create the company with this one.
    await this.#q('UPDATE whitelabels SET company_password_hash = :hash, updated_at = NOW() WHERE id = :id RETURNING id', {
      id,
      hash: await hashPassword(password, PASSWORD_ROUNDS),
    });
    return { changed: true };
  }

  async setMaintenance(id, on) {
    const row = await this.#live(id);
    const result = await this.link(row, 'PUT', '/maintenance', { on });
    await this.#q('UPDATE whitelabels SET maintenance = :on, updated_at = NOW() WHERE id = :id RETURNING id', { id, on: result?.maintenance === true });
    return { maintenance: result?.maintenance === true };
  }

  async setPalette(id, palette) {
    const row = await this.#row(id);
    if (row.status === 'live') await this.link(row, 'PUT', '/palette', { palette });
    await this.#q('UPDATE whitelabels SET palette = CAST(:palette AS JSONB), updated_at = NOW() WHERE id = :id RETURNING id', {
      id,
      palette: palette ? JSON.stringify(palette) : null,
    });
    return { palette };
  }

  /** A one-time link (about a minute) to the copy's admin, read-only, as its company. */
  async preview(id) {
    const row = await this.#live(id);
    const { code, expiresInSeconds } = await this.link(row, 'POST', '/preview');
    return { url: `https://${row.admin_domain}/preview?code=${encodeURIComponent(code)}`, expiresInSeconds };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Setup again / delete
  // ══════════════════════════════════════════════════════════════════════

  async retrySetup(id, actor) {
    const row = await this.#row(id);
    if (row.status !== 'failed') throw errors.NOT_FAILED({ status: row.status });
    // A failed delete is finished by deleting again, never by building it back.
    const [last] = await this.#q('SELECT kind FROM whitelabel_jobs WHERE whitelabel_id = :id ORDER BY id DESC LIMIT 1', { id });
    if (last?.kind === 'delete') throw errors.DELETE_FAILED();
    await this.db.transaction(async (transaction) => {
      await this.#q("UPDATE whitelabels SET status = 'queued', updated_at = NOW() WHERE id = :id RETURNING id", { id }, transaction);
      await this.#enqueue(id, 'create', actor, transaction);
    });
    return view(await this.#row(id));
  }

  /**
   * Delete: never while a setup or delete runs. Live: it must be switched off, have no transfer
   * still on its way, and either hold no money or the Super Admin confirms. The setup script then
   * keeps a final database export and removes everything (scripts/whitelabel/).
   */
  async remove({ id, confirmName, acknowledgeBalances, actor }) {
    const row = await this.#row(id);
    if (confirmName !== row.name) throw errors.NAME_MISMATCH();
    if (['creating', 'deleting'].includes(row.status)) throw errors.BUSY({ status: row.status });

    // Never started: nothing exists on the machine — cancel the queued setup and close the row.
    if (row.status === 'queued') {
      await this.db.transaction(async (transaction) => {
        await this.#q(
          `UPDATE whitelabel_jobs SET status = 'failed', step = 'cancelled', finished_at = NOW()
            WHERE whitelabel_id = :id AND status = 'queued' RETURNING id`,
          { id },
          transaction
        );
        await this.#q("UPDATE whitelabels SET status = 'deleted', company_password_hash = NULL, updated_at = NOW() WHERE id = :id RETURNING id", { id }, transaction);
      });
      return { status: 'deleted' };
    }

    if (row.status === 'live') {
      if (!row.maintenance) throw errors.MUST_BE_OFF();
      const [{ pending }] = await this.#q("SELECT COUNT(*)::int AS pending FROM whitelabel_transfers WHERE whitelabel_id = :id AND status = 'pending'", { id });
      if (pending) throw errors.TRANSFERS_PENDING({ pending });

      let held = null;
      try {
        const { balances, counts } = await this.link(row, 'GET', '/summary');
        const nonZero = Object.values(balances).some((v) => !money.isZero(v));
        if (nonZero || counts.playersWithBalance > 0) held = { balances, playersWithBalance: counts.playersWithBalance };
      } catch (error) {
        // Unreadable: the Super Admin must confirm blind.
        held = { unreadable: error.message };
      }
      if (held && !acknowledgeBalances) throw errors.BALANCES_REMAIN(held);
    }

    await this.db.transaction(async (transaction) => {
      await this.#q("UPDATE whitelabels SET status = 'deleting', updated_at = NOW() WHERE id = :id RETURNING id", { id }, transaction);
      await this.#enqueue(id, 'delete', actor, transaction);
    });
    this.logger?.warn({ whitelabelId: id, slug: row.slug, actorStaffId: actor.id }, 'Whitelabel queued for delete');
    return { status: 'deleting' };
  }
}

module.exports = { WhitelabelsService, view };
