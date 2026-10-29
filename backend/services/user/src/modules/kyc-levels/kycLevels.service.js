'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const errors = require('./kycLevels.errors');
const { MAGIC_BYTES, MAX_FILE_BYTES } = require('../kyc/kyc.constants');
const { ownerWhere, assertPlayerVisible } = require('../directory/playerScope');

const STATUS = Object.freeze({ PENDING: 'Pending', VERIFIED: 'Verified', REJECTED: 'Rejected' });
const LABEL = Object.freeze({ 3: 'Proof of Address', 4: 'Source of Income' });
const EXTENSION = Object.freeze({ 'image/jpeg': '.jpg', 'image/png': '.png', 'application/pdf': '.pdf' });
const iso = (d) => (d ? new Date(d).toISOString() : null);

/**
 * KYC Levels 3 and 4 (rainbet) — see migration 167. Documents are stored and served like the
 * identity KYC's: the KYC directory, a random name, the type sniffed from the bytes, owner or
 * staff only.
 */
class KycLevelService {
  constructor(deps) {
    this.deps = deps;
    this.models = deps.models;
    this.logger = deps.logger;
    this.storageDir = deps.config.KYC_STORAGE_DIR;
  }

  /** Where the player stands: the identity KYC and each level, with whether it can be sent. */
  async status(userId) {
    const [identity, rows] = await Promise.all([
      this.models.UserKyc.findOne({ where: { user_id: String(userId) }, attributes: ['status'], raw: true }),
      this.models.UserKycLevel.findAll({ where: { user_id: userId }, raw: true }),
    ]);
    const byLevel = new Map(rows.map((r) => [Number(r.level), r]));
    const shape = (level, unlocked) => {
      const row = byLevel.get(level);
      return {
        level,
        label: LABEL[level],
        unlocked,
        status: row?.status ?? null,
        rejectionReason: row?.status === STATUS.REJECTED ? row.rejection_reason : null,
        submittedAt: iso(row?.created_at),
      };
    };
    const three = shape(3, identity?.status === STATUS.VERIFIED);
    return { identity: identity?.status ?? null, levels: [three, shape(4, three.status === STATUS.VERIFIED)] };
  }

  /** Send (or, after a rejection, send again) the document for `level`. */
  async submit(userId, level, file) {
    if (!file) throw errors.DOCUMENT_REQUIRED({ level });
    const { levels } = await this.status(userId);
    const current = levels.find((l) => l.level === level);
    if (!current.unlocked) throw errors.LOCKED({ level });
    if (current.status === STATUS.PENDING) throw errors.ALREADY_PENDING({ level });
    if (current.status === STATUS.VERIFIED) throw errors.ALREADY_VERIFIED({ level });

    const stored = await this.#store(userId, level, file);
    const fields = {
      document_path: stored,
      status: STATUS.PENDING,
      rejection_reason: null,
      reviewed_by: null,
      reviewed_at: null,
      created_at: new Date(),
    };
    const existing = await this.models.UserKycLevel.findOne({ where: { user_id: userId, level } });
    if (existing) await existing.update(fields);
    else await this.models.UserKycLevel.create({ user_id: userId, level, ...fields });
    this.logger?.info({ userId: String(userId), level }, 'KYC level submitted');
    return (await this.status(userId)).levels.find((l) => l.level === level);
  }

  async myDocument(userId, level) {
    const row = await this.models.UserKycLevel.findOne({ where: { user_id: userId, level }, raw: true });
    if (!row) throw errors.NOT_FOUND({ level });
    return this.#read(row.document_path);
  }

  // ══ Staff ═══════════════════════════════════════════════════════════

  /** The queue, newest first, in the caller's tree (direct players need the root). */
  async list(staff, { status, limit = 50 } = {}) {
    const rows = await this.models.UserKycLevel.findAll({
      where: { ...(await ownerWhere(this.deps, staff?.id, 'user_id')), ...(status ? { status } : {}) },
      order: [['created_at', 'DESC']],
      limit,
      raw: true,
    });
    const users = rows.length
      ? await this.models.Users.findAll({ where: { id: [...new Set(rows.map((r) => String(r.user_id)))] }, attributes: ['id', 'name'], raw: true })
      : [];
    const names = new Map(users.map((u) => [String(u.id), u.name]));
    return rows.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      player: names.get(String(r.user_id)) ?? null,
      level: Number(r.level),
      label: LABEL[r.level],
      status: r.status,
      rejectionReason: r.rejection_reason,
      submittedAt: iso(r.created_at),
      reviewedAt: iso(r.reviewed_at),
    }));
  }

  async review(staff, id, { status, rejectionReason }) {
    const row = await this.models.UserKycLevel.findByPk(id);
    if (!row) throw errors.NOT_FOUND({ id });
    await assertPlayerVisible(this.deps, staff?.id, row.user_id);
    if (row.status !== STATUS.PENDING) throw errors.NOT_PENDING({ id });
    if (status === STATUS.REJECTED && !rejectionReason) throw errors.REASON_REQUIRED();
    await row.update({
      status,
      rejection_reason: status === STATUS.REJECTED ? rejectionReason : null,
      reviewed_by: staff?.id ?? null,
      reviewed_at: new Date(),
    });
    this.logger?.info({ id: String(id), status, staffId: staff?.id }, 'KYC level reviewed');
    return { id: String(id), status };
  }

  async documentForStaff(staff, id) {
    const row = await this.models.UserKycLevel.findByPk(id, { raw: true });
    if (!row) throw errors.NOT_FOUND({ id });
    await assertPlayerVisible(this.deps, staff?.id, row.user_id);
    return this.#read(row.document_path);
  }

  // ══ Files ═══════════════════════════════════════════════════════════

  async #store(userId, level, file) {
    if (file.size > MAX_FILE_BYTES) throw errors.FILE_TOO_LARGE({ size: file.size });
    const sniffed = MAGIC_BYTES.find(({ bytes }) => file.buffer?.length >= 4 && bytes.every((b, i) => file.buffer[i] === b));
    if (!sniffed) throw errors.INVALID_FILE_TYPE({ declared: file.mimetype });
    const filename = `${userId}-level${level}-${crypto.randomBytes(16).toString('hex')}${EXTENSION[sniffed.mime]}`;
    await fs.mkdir(this.storageDir, { recursive: true });
    await fs.writeFile(path.join(this.storageDir, filename), file.buffer, { mode: 0o600 });
    return filename;
  }

  /** A stored document — refused if the stored name would resolve outside the KYC directory. */
  async #read(stored) {
    const root = path.resolve(this.storageDir);
    const full = path.resolve(root, stored);
    if (!full.startsWith(root + path.sep)) throw errors.NOT_FOUND({});
    const ext = path.extname(full).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' : ext === '.pdf' ? 'application/pdf' : 'image/jpeg';
    return { buffer: await fs.readFile(full), contentType, filename: path.basename(full) };
  }
}

module.exports = { KycLevelService, STATUS };
