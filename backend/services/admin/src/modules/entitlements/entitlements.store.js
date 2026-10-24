'use strict';

const crypto = require('crypto');
const { Op } = require('sequelize');

const { AppError, featureCatalogue, featureOptions, regionPolicy, withdrawalCap, withdrawalDailyLimit } = require('@ibitplay/common');
const { cleanBranding } = require('../branding/branding.rules');

/**
 * The owner's entitlements, kept in the site database (migration 142).
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE OWNER PANEL WRITES, THIS SERVICE VERIFIES — docs/OWNER-PANEL.md §3
 *
 * The owner panel signs every new version and sends it here
 * (`PUT /api/v1/admin/owner/entitlements`, `x-owner-key`, modules/owner).
 * `accept()` checks it as the old poll did, appends it to
 * `owner_entitlements` (one row per version, with its audit row) and runs
 * `onChange`: the document is applied to `site_features` and coins, and the
 * masked public view is pushed down the player sockets.
 *
 * Every read is from the table: `start()` loads the newest row at boot, and
 * re-reads it every `OWNER_POLL_SECONDS` so a second admin-service process
 * follows a save made on the first. No owner key, password or signing key
 * is ever stored — only the signed document, its signatures and a label.
 *
 * ── FAILS OPEN ───────────────────────────────────────────────────────────
 *
 * No row (or the table unreadable before the first good read) means
 * everything is entitled — today's behaviour. A read that fails later keeps
 * the last good copy in memory.
 *
 * ── WHAT A NEW VERSION MUST PROVE ────────────────────────────────────────
 *
 *   1. A KEY THAT IS NEVER SENT. With `OWNER_VERIFY_KEY` (the owner panel's
 *      Ed25519 public key) set, only `signatureEd25519` is believed; the HMAC
 *      — keyed with the same secret as `x-owner-key` — is then ignored.
 *      Unset, the HMAC is checked.
 *   2. FRESHNESS. `issuedAt` inside the signed data must be within
 *      `OWNER_MAX_AGE_SECONDS` of now, so a captured request cannot be
 *      replayed later. Required with the Ed25519 key.
 *   3. ORDER AND SITE. The version must be higher than the newest row (an
 *      old "everything on" document cannot undo a newer block, and two owner
 *      panels saving at once cannot both win), and the site must be
 *      `OWNER_SITE_KEY` (else the site of the newest row).
 * ═════════════════════════════════════════════════════════════════════════
 */

/** Hex HMAC-SHA256 of `JSON.stringify(data)` — what the owner panel signs. */
function sign(data, secret) {
  return crypto.createHmac('sha256', secret).update(JSON.stringify(data)).digest('hex');
}

function verifySignature(data, signature, secret) {
  if (!secret || typeof signature !== 'string' || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = Buffer.from(sign(data, secret), 'hex');
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/**
 * The owner panel's Ed25519 public key: PEM, or base64 of the SPKI DER (one
 * line, which is what fits in `.env`). Null when unset or unreadable.
 */
function readVerifyKey(value, logger) {
  if (!value) return null;
  try {
    const text = String(value).replace(/\\n/g, '\n').trim();
    const key = text.includes('BEGIN')
      ? crypto.createPublicKey(text)
      : crypto.createPublicKey({ key: Buffer.from(text, 'base64'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ed25519') throw new Error(`expected an ed25519 key, got ${key.asymmetricKeyType}`);
    return key;
  } catch (error) {
    logger?.error({ err: error.message }, 'OWNER_VERIFY_KEY is not a usable Ed25519 public key — no owner answer will be accepted');
    return false;
  }
}

function verifyEd25519(data, signature, key) {
  if (!key || typeof signature !== 'string' || !signature) return false;
  try {
    return crypto.verify(null, Buffer.from(JSON.stringify(data)), key, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}


/** Only booleans survive: anything else in the maps reads as "missing", i.e. entitled. */
function booleans(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return {};
  return Object.fromEntries(Object.entries(map).filter(([, v]) => typeof v === 'boolean'));
}

/**
 * The owner's template (docs/OWNER-PANEL.md §2): a catalogue key, an old
 * clone name resolved to its key, or null. Anything else is dropped rather
 * than refusing the whole document — the plan itself still applies.
 */
function templateOf(value) {
  if (typeof value !== 'string' || !value) return null;
  const key = featureCatalogue.resolveTemplateKey(value);
  return Object.hasOwn(featureCatalogue.TEMPLATES, key) ? key : null;
}

/**
 * The owner's choice of variant per feature (docs/OWNER-PANEL.md §2): only
 * string values survive; the features service checks each against the
 * catalogue. Null when the document has no `variants` (an older owner panel),
 * which keeps the template-only behaviour.
 */
function variantsOf(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return null;
  return Object.fromEntries(Object.entries(map).filter(([, v]) => typeof v === 'string' && v));
}

/**
 * Custom coin definitions the owner added (phase B: `coins: [{ code, kind,
 * name, … }]`). Carried as plain objects with a valid code; applying them is
 * the currencies service's job. `[]` when absent.
 */
function coinsOf(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((c) => c && typeof c === 'object' && typeof c.code === 'string' && /^[A-Z][A-Z0-9]{1,9}$/.test(c.code))
    .slice(0, 200)
    .map((c) => ({ ...c }));
}

function normalise(data) {
  if (!data || typeof data !== 'object' || !Number.isFinite(Number(data.version))) return null;
  return {
    site: data.site ?? null,
    version: Number(data.version),
    updatedAt: data.updatedAt ?? null,
    features: booleans(data.features),
    flags: booleans(data.flags),
    template: templateOf(data.template),
    variants: variantsOf(data.variants),
    coins: coinsOf(data.coins),
    // Owner-only feature options (featureOptions.js); unknown keys dropped, defaults applied by readers.
    options: featureOptions.cleanOptions(data.options),
    // Region restriction's list type and countries (regionPolicy.js); the mode is the policy's variant.
    region: regionPolicy.cleanRegion(data.region),
    // Withdrawal requirements' deposit cap (withdrawalCap.js); KYC / wagering are the policy's variant.
    withdrawalCap: withdrawalCap.cleanWithdrawalCap(data.withdrawalCap),
    // Daily withdrawal limit per currency (withdrawalDailyLimit.js); absent = off.
    withdrawalDailyLimit: withdrawalDailyLimit.cleanWithdrawalDailyLimit(data.withdrawalDailyLimit),
    // Player withdrawals on every rail (withdrawBlock.js); absent = on.
    withdrawalsEnabled: data.withdrawalsEnabled !== false,
    // Site name, metadata and logo file references (modules/branding); null = not branded.
    branding: cleanBranding(data.branding),
  };
}


/** A refused document: 4xx with a stable code, never the secret. */
const refuse = (status, code, message) => new AppError(message, status, code);

/**
 * @param {object}   options
 * @param {object}   options.config   OWNER_SHARED_SECRET, OWNER_VERIFY_KEY, OWNER_SITE_KEY, OWNER_MAX_AGE_SECONDS, OWNER_POLL_SECONDS
 * @param {object}   options.db       the connection: `models.OwnerEntitlement`, `models.OwnerAudit`, `sequelize`
 * @param {Function} [options.onChange] called with `current()` on a new version
 */
function createEntitlementsStore({ config, logger, db, onChange: initialOnChange }) {
  const secret = config.OWNER_SHARED_SECRET || null;
  const intervalMs = Math.max(1, Number(config.OWNER_POLL_SECONDS) || 15) * 1000;
  // `false` = configured but unusable: refuse everything rather than fall back to the HMAC.
  const verifyKey = readVerifyKey(config.OWNER_VERIFY_KEY, logger);
  const maxAgeMs = Math.max(30, Number(config.OWNER_MAX_AGE_SECONDS) || 300) * 1000;
  const expectedSite = config.OWNER_SITE_KEY || null;

  let doc = null;
  let savedAt = null;
  let timer = null;
  let onChange = initialOnChange;

  // Loads and saves run one at a time, so a version check never races a write.
  let queue = Promise.resolve();
  const serial = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  async function changed() {
    if (onChange) await Promise.resolve(onChange(current())).catch((error) => logger?.warn({ err: error.message }, 'Entitlements change push failed'));
  }

  /** The newest stored row, or null. */
  function latestRow() {
    return db.models.OwnerEntitlement.findOne({ order: [['version', 'DESC']], raw: true });
  }

  async function loadNow({ notify = true } = {}) {
    try {
      const row = await latestRow();
      const data = row ? normalise(row.doc) : null;
      if (data && data.version !== doc?.version) {
        doc = data;
        savedAt = new Date(row.created_at ?? Date.now()).toISOString();
        logger?.info({ version: data.version }, 'Owner entitlements loaded from the database');
        if (notify) await changed();
      }
    } catch (error) {
      logger?.warn({ err: error.message, version: doc?.version ?? null }, doc ? 'Could not read owner_entitlements — keeping the last good copy' : 'Could not read owner_entitlements — everything is entitled');
    }
    return current();
  }

  /** The checks of "what a new version must prove". Throws a 4xx. */
  function believe(body) {
    const data = body?.data;
    if (verifyKey !== null) {
      if (!verifyEd25519(data, body?.signatureEd25519, verifyKey)) throw refuse(400, 'BAD_SIGNATURE', 'Bad Ed25519 signature');
    } else if (!verifySignature(data, body?.signature, secret)) {
      throw refuse(400, 'BAD_SIGNATURE', 'Bad signature');
    }

    const issuedAt = Date.parse(data?.issuedAt ?? '');
    if (Number.isFinite(issuedAt)) {
      if (Math.abs(Date.now() - issuedAt) > maxAgeMs) throw refuse(400, 'STALE_DOCUMENT', 'issuedAt is outside OWNER_MAX_AGE_SECONDS');
    } else if (verifyKey !== null) {
      throw refuse(400, 'STALE_DOCUMENT', 'The document has no issuedAt');
    }

    const next = normalise(data);
    if (!next || !Number.isInteger(next.version) || next.version < 1) throw refuse(422, 'VALIDATION_ERROR', 'Malformed entitlements document');
    if (doc && next.version <= doc.version) throw refuse(409, 'VERSION_CONFLICT', `Version ${next.version} is not newer than the stored version ${doc.version}`);
    const site = expectedSite ?? doc?.site ?? null;
    if (site && next.site !== site) throw refuse(409, 'WRONG_SITE', `The document is for site "${next.site}", not "${site}"`);
    return next;
  }

  /**
   * A new signed version from the owner panel: verify, store (with its audit
   * entry, one transaction), apply. Returns `current()`; throws a 4xx when the
   * document is refused, which leaves everything as it was.
   */
  function accept(body, { updatedBy = null, audit = null } = {}) {
    return serial(async () => {
      await loadNow(); // the newest row first: another process may have saved since
      const next = believe(body);
      const label = typeof updatedBy === 'string' && updatedBy ? updatedBy.slice(0, 190) : null;
      try {
        await db.sequelize.transaction(async (transaction) => {
          await db.models.OwnerEntitlement.create(
            {
              version: next.version,
              site: next.site,
              doc: body.data,
              signature: typeof body.signature === 'string' ? body.signature : null,
              signature_ed25519: typeof body.signatureEd25519 === 'string' ? body.signatureEd25519 : null,
              updated_by: label,
            },
            { transaction }
          );
          if (audit) await db.models.OwnerAudit.create({ version: next.version, at: new Date(Date.parse(audit.at) || Date.now()), updated_by: label, entry: audit }, { transaction });
        });
      } catch (error) {
        if (error.name === 'SequelizeUniqueConstraintError') throw refuse(409, 'VERSION_CONFLICT', `Version ${next.version} was saved meanwhile — reload and try again`);
        throw error;
      }
      doc = next;
      savedAt = new Date().toISOString();
      logger?.info({ version: next.version }, 'Owner entitlements saved');
      await changed();
      return current();
    });
  }

  /** The audit trail, newest first: `{ entries, next }`, `next` the cursor for the following page. */
  async function audit({ limit = 100, before = null } = {}) {
    const rows = await db.models.OwnerAudit.findAll({
      where: before ? { id: { [Op.lt]: before } } : {},
      order: [['id', 'DESC']],
      limit,
      raw: true,
    });
    return { entries: rows.map((r) => r.entry), next: rows.length === limit ? Number(rows.at(-1).id) : null };
  }

  /** `{ features, flags, template, variants, version, fetchedAt, source }` — never a secret. */
  function current() {
    if (!doc) return { features: {}, flags: {}, template: null, variants: null, coins: [], options: {}, region: regionPolicy.cleanRegion(null), withdrawalCap: withdrawalCap.cleanWithdrawalCap(null), withdrawalDailyLimit: withdrawalDailyLimit.cleanWithdrawalDailyLimit(null), withdrawalsEnabled: true, branding: null, version: 0, fetchedAt: null, source: 'default' };
    return {
      features: { ...doc.features },
      flags: { ...doc.flags },
      template: doc.template ?? null,
      variants: doc.variants ? { ...doc.variants } : null,
      coins: (doc.coins ?? []).map((c) => ({ ...c })),
      options: JSON.parse(JSON.stringify(doc.options ?? {})),
      region: regionPolicy.cleanRegion(doc.region),
      withdrawalCap: withdrawalCap.cleanWithdrawalCap(doc.withdrawalCap),
      withdrawalDailyLimit: withdrawalDailyLimit.cleanWithdrawalDailyLimit(doc.withdrawalDailyLimit),
      withdrawalsEnabled: doc.withdrawalsEnabled !== false,
      branding: doc.branding ? JSON.parse(JSON.stringify(doc.branding)) : null,
      version: doc.version,
      fetchedAt: savedAt,
      source: 'owner',
    };
  }

  return {
    current,
    accept,
    audit,
    latestRow,
    /** Re-read the newest row now; `onChange` on a new version. Never throws. */
    load: () => serial(() => loadNow()),
    /** Load the newest row (boot applies it itself, so no onChange), then follow the table. */
    async start({ onChange: handler } = {}) {
      if (handler) onChange = handler;
      await serial(() => loadNow({ notify: false }));
      timer = setInterval(() => serial(() => loadNow()), intervalMs);
      timer.unref?.();
      return this;
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

module.exports = { createEntitlementsStore, verifySignature, sign };
