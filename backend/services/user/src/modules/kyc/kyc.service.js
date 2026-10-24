'use strict';

const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');

const { Op } = require('@ibitplay/db');

const errors = require('./kyc.errors');
const {
  KYC_STATUS,
  MAGIC_BYTES,
  MAX_FILE_BYTES,
  DOCUMENT_FIELDS,
} = require('./kyc.constants');
const { ownerWhere, assertPlayerVisible, withChannel } = require('../directory/playerScope');
const { notifyPlayer } = require('../notifications/notifyPlayer');

/**
 * Identity verification.
 *
 * Three defects in `legacy/kyc/` that this fixes, all of them consequential:
 *
 * 1. **`PUT /kyc/update-status` had no authentication.** Its own comment called
 *    it "Admin route to update KYC status", but nothing enforced that — the
 *    body carried `userId` and `status`, so any caller could mark any account
 *    Verified. On a gambling platform KYC is the control that gates withdrawals
 *    and age limits, so this was the whole verification process bypassed by one
 *    request.
 *
 * 2. **`GET /kyc/documents/:filename` read straight off the filesystem**, with
 *    a denylist (`..` and `/`) as its only defence and no auth. Every uploaded
 *    passport and ID card on the platform was fetchable by anyone who could
 *    guess a filename — and filenames were `${userId}_${field}_${timestamp}`,
 *    so they were guessable. Documents are now addressed by record id and
 *    served only to the owner or to staff.
 *
 * 3. **Uploads were trusted on their declared MIME type.** `file.mimetype` is
 *    whatever the client sends. Files are now checked against their magic bytes.
 */
class KycService {
  constructor({ models, db, config, logger, clients }) {
    this.models = models;
    this.clients = clients;
    this.db = db;
    this.config = config;
    this.logger = logger;
    this.storageDir = config.KYC_STORAGE_DIR;
  }

  /** @legacy GET /kyc/status/:userId */
  async getStatus(userId) {
    // user_kyc.user_id is VARCHAR(50), not an integer. Passing a number makes
    // Postgres raise a type error rather than simply not matching.
    const row = await this.models.UserKyc.findOne({
      where: { user_id: String(userId) },
      order: [['id', 'DESC']],
      raw: true,
    });

    if (!row) return { status: 'NotSubmitted', submitted: false };

    return {
      /**
       * The row's own id, and WITHOUT IT `GET /kyc/documents/:kycId/:field` IS
       * UNREACHABLE FROM A CLIENT.
       *
       * That route takes a kycId, resolves the row and refuses unless the
       * caller owns it — correctly, and with the same error for "not yours" as
       * for "not found" so ids cannot be enumerated. But this was the only
       * player-facing read of a KYC record and it did not say which record,
       * so a player had no way to learn their own id and no way to ask for
       * their own document. The route could only be exercised by staff.
       *
       * Naming it `kycId` rather than `id` because that is what the route
       * parameter, the service argument and every log line in this module
       * already call it.
       */
      kycId: row.id,
      status: row.status,
      submitted: true,
      submittedAt: row.created_at,
      reviewedAt: row.updated_at,
      // Only surfaced when rejected — there is nothing to act on otherwise.
      rejectionReason: row.status === KYC_STATUS.REJECTED ? row.rejection_reason : null,
      documentType: row.document_type,
      documents: this.#describeDocuments(row),
    };
  }

  /**
   * Submit or resubmit an application.
   *
   * @legacy POST /kyc/submit
   */
  async submit({ userId, details, files }) {
    const existing = await this.models.UserKyc.findOne({
      where: { user_id: String(userId) },
      order: [['id', 'DESC']],
      raw: true,
    });

    if (existing?.status === KYC_STATUS.VERIFIED) throw errors.ALREADY_VERIFIED({ userId });
    if (existing?.status === KYC_STATUS.PENDING) throw errors.ALREADY_PENDING({ userId });

    const provided = DOCUMENT_FIELDS.filter((f) => files?.[f]);
    if (!provided.length) throw errors.DOCUMENTS_REQUIRED();

    const stored = {};
    for (const field of provided) {
      stored[field] = await this.#storeDocument(userId, field, files[field]);
    }

    const payload = {
      user_id: String(userId),
      first_name: details.firstName,
      last_name: details.lastName,
      gender: details.gender ?? null,
      date_of_birth: details.dateOfBirth,
      address: details.address,
      city: details.city,
      country: details.country,
      document_type: details.documentType,
      id_front_path: stored.idFront ?? null,
      id_back_path: stored.idBack ?? null,
      passport_path: stored.passport ?? null,
      status: KYC_STATUS.PENDING,
      rejection_reason: null,
    };

    // A rejected application is updated in place rather than stacking rows, so
    // "the player's KYC" stays a single record.
    const row = existing
      ? await this.models.UserKyc.findByPk(existing.id).then((r) => r.update(payload))
      : await this.models.UserKyc.create(payload);

    this.logger?.info({ userId, kycId: row.id }, 'KYC submission received');
    return { id: row.id, status: KYC_STATUS.PENDING, documents: Object.keys(stored) };
  }

  /**
   * Staff decision on an application.
   *
   * @legacy PUT /kyc/update-status
   */
  async review({ userId, status, rejectionReason }, staff) {
    if (status === KYC_STATUS.REJECTED && !rejectionReason) {
      throw errors.REJECTION_REASON_REQUIRED();
    }

    // `users:write` reaches masters; the player still has to be theirs.
    await assertPlayerVisible(this, staff?.id, userId);

    // KYC is for direct users only (docs/KYC.md).
    const player = await this.models.Users.findByPk(userId, { attributes: ['parent_staff_id'], raw: true });
    if (player?.parent_staff_id != null) throw errors.DIRECT_USERS_ONLY({ userId });

    const row = await this.models.UserKyc.findOne({
      where: { user_id: String(userId) },
      order: [['id', 'DESC']],
    });
    if (!row) throw errors.NOT_FOUND({ userId });
    /* The submission this decision is about — a rejected application is
       resubmitted IN PLACE, so the row id alone does not name one review. */
    const submission = `${row.id}:${new Date(row.updated_at ?? row.created_at ?? 0).getTime()}`;

    await row.update({
      status,
      rejection_reason: status === KYC_STATUS.REJECTED ? rejectionReason : null,
    });

    this.logger?.info(
      { userId, kycId: row.id, status, staffId: staff?.id },
      'KYC application reviewed'
    );
    void notifyPlayer(userId, {
      [KYC_STATUS.VERIFIED]: {
        kind: 'kyc_approved',
        key: `kyc:verified:${submission}`,
        title: 'Identity verified',
        body: 'Your KYC documents were approved. Withdrawals are now open to you.',
        link: '/settings',
      },
      [KYC_STATUS.REJECTED]: {
        kind: 'kyc_rejected',
        key: `kyc:rejected:${submission}`,
        title: 'Identity verification rejected',
        body: `Your KYC documents were not accepted. Reason: ${rejectionReason}. Please submit them again.`,
        link: '/settings',
        meta: { reason: rejectionReason },
      },
    }[status]);

    return { userId, status, kycId: row.id };
  }

  /**
   * @legacy GET /kyc/admin/applications
   *
   * The caller's tree only. `users:read` reaches every agent, and this listed
   * every player's name, date of birth and address site-wide.
   */
  async listApplications({ staff, status, search, limit, offset }) {
    // `user_kyc.user_id` VARCHAR hai. KYC is for direct users only (docs/KYC.md), so the queue is
    // always the direct channel; an old agent-tree row stays in the table but is never listed.
    const where = withChannel({
      ...(await ownerWhere(this, staff?.id, 'user_id')),
      ...(status ? { status } : {}),
      ...(search
        ? {
            [Op.or]: [
              { first_name: { [Op.iLike]: `%${search}%` } },
              { last_name: { [Op.iLike]: `%${search}%` } },
              { country: { [Op.iLike]: `%${search}%` } },
            ],
          }
        : {}),
    }, 'user_id', 'direct', { text: true });

    const result = await this.models.UserKyc.findAndCountAll({
      where,
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    return {
      count: result.count,
      // Document PATHS are never returned — only which documents exist. The
      // path is an internal detail, and returning it invites clients to build
      // their own URLs to the filesystem.
      rows: result.rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        firstName: r.first_name,
        lastName: r.last_name,
        gender: r.gender,
        dateOfBirth: r.date_of_birth,
        address: r.address,
        city: r.city,
        country: r.country,
        documentType: r.document_type,
        status: r.status,
        rejectionReason: r.rejection_reason,
        submittedAt: r.created_at,
        reviewedAt: r.updated_at,
        documents: this.#describeDocuments(r),
      })),
    };
  }

  /**
   * Read one document.
   *
   * @legacy GET /kyc/documents/:filename
   *
   * Addressed by record id and field. The caller must be the owner or staff —
   * decided by the route, not here — and the resolved path is checked to be
   * inside the storage directory before anything is read.
   */
  async readDocument({ kycId, field, requesterId, isStaff }) {
    const row = await this.models.UserKyc.findByPk(kycId, { raw: true });
    if (!row) throw errors.DOCUMENT_NOT_FOUND({ kycId });

    if (isStaff) {
      // A staff reader may open only their own tree's documents — and an
      // out-of-tree record answers exactly like a missing one.
      try {
        await assertPlayerVisible(this, requesterId, row.user_id);
      } catch (error) {
        if (error?.status === 404) throw errors.DOCUMENT_NOT_FOUND({ kycId });
        throw error;
      }
    }

    if (!isStaff && Number(row.user_id) !== Number(requesterId)) {
      // Same error as "not found": confirming the record exists would let
      // someone enumerate which ids hold documents.
      throw errors.DOCUMENT_NOT_FOUND({ kycId });
    }

    const column = { idFront: 'id_front_path', idBack: 'id_back_path', passport: 'passport_path' }[field];
    const stored = row[column];
    if (!stored) throw errors.DOCUMENT_NOT_FOUND({ kycId, field });

    const fullPath = path.resolve(this.storageDir, stored);

    // Defence in depth: even though `stored` is a name this service generated,
    // a path that escapes the storage directory is refused rather than read.
    const root = path.resolve(this.storageDir);
    if (!fullPath.startsWith(root + path.sep)) {
      this.logger?.error({ kycId, stored }, 'Refused a KYC path outside the storage directory');
      throw errors.DOCUMENT_NOT_FOUND({ kycId, field });
    }

    try {
      const buffer = await fs.readFile(fullPath);
      return { buffer, contentType: this.#contentTypeOf(fullPath), filename: path.basename(fullPath) };
    } catch {
      throw errors.DOCUMENT_NOT_FOUND({ kycId, field });
    }
  }

  // ══════════════════════════════════════════════════════════════════════

  /**
   * Write an uploaded document to disk.
   *
   * The filename is random rather than `${userId}_${field}_${timestamp}`, which
   * was guessable — and guessable filenames were half of what made the legacy
   * document endpoint dangerous.
   */
  async #storeDocument(userId, field, file) {
    if (file.size > MAX_FILE_BYTES) throw errors.FILE_TOO_LARGE({ field, size: file.size });

    const detected = this.#sniff(file.buffer);
    if (!detected) throw errors.INVALID_FILE_TYPE({ field, declared: file.mimetype });

    const extension = { 'image/jpeg': '.jpg', 'image/png': '.png', 'application/pdf': '.pdf' }[detected];
    const filename = `${userId}-${field}-${crypto.randomBytes(16).toString('hex')}${extension}`;

    await fs.mkdir(this.storageDir, { recursive: true });
    await fs.writeFile(path.join(this.storageDir, filename), file.buffer, { mode: 0o600 });

    return filename;
  }

  /** What the file actually is, from its leading bytes. */
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

  /** Which documents exist, without leaking where they live. */
  #describeDocuments(row) {
    return {
      idFront: Boolean(row.id_front_path),
      idBack: Boolean(row.id_back_path),
      passport: Boolean(row.passport_path),
    };
  }
}

module.exports = { KycService };
