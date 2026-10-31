'use strict';

/**
 * The owner's entitlement document, its audit trail and its branding images,
 * in the site database (they used to live as files in owner-panel/data/ and
 * backend/data/, pulled over HTTP by admin-service's poller).
 *
 *   owner_entitlements      one row per saved version (append-only)
 *     version               PK, strictly increasing
 *     site                  the document's site key
 *     doc                   the signed document, exactly as signed (JSONB)
 *     signature             hex HMAC-SHA256 of JSON.stringify(doc)
 *     signature_ed25519     base64 Ed25519 signature of the same, or NULL
 *     updated_by            a label (the owner panel's username), never a credential
 *
 *   owner_audit             one row per owner save (what audit.jsonl held)
 *     id, version, at, updated_by, entry (JSONB: { at, user, version, changes, seededFrom? })
 *
 *   owner_branding_assets   uploaded images, by content: file = <sha256>.<ext>
 *     file PK, content_type, byte_size, bytes (BYTEA)
 *
 * NO SECRET IS EVER STORED HERE: OWNER_PASSWORD, OWNER_SESSION_SECRET,
 * OWNER_SHARED_SECRET and OWNER_SIGNING_KEY stay in each host's env. A row is
 * written only by admin-service after the document's signature verified.
 *
 * Idempotent (IF NOT EXISTS). `down` drops the three tables.
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS owner_entitlements (
       version            INTEGER PRIMARY KEY CHECK (version > 0),
       site               VARCHAR(100),
       doc                JSONB NOT NULL,
       signature          VARCHAR(128),
       signature_ed25519  VARCHAR(200),
       updated_by         VARCHAR(190),
       created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
    { transaction }
  );
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS owner_audit (
       id          BIGSERIAL PRIMARY KEY,
       version     INTEGER NOT NULL,
       at          TIMESTAMPTZ NOT NULL DEFAULT now(),
       updated_by  VARCHAR(190),
       entry       JSONB NOT NULL,
       created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
    { transaction }
  );
  await sequelize.query('CREATE INDEX IF NOT EXISTS owner_audit_at_idx ON owner_audit (at DESC, id DESC)', { transaction });
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS owner_branding_assets (
       file          VARCHAR(80) PRIMARY KEY,
       content_type  VARCHAR(40) NOT NULL,
       byte_size     INTEGER NOT NULL,
       bytes         BYTEA NOT NULL,
       created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
    { transaction }
  );
  logger?.info('owner_entitlements, owner_audit and owner_branding_assets present');
}

async function down({ sequelize, transaction, logger }) {
  for (const table of ['owner_branding_assets', 'owner_audit', 'owner_entitlements']) {
    await sequelize.query(`DROP TABLE IF EXISTS ${table}`, { transaction });
  }
  logger?.warn('Dropped owner_entitlements, owner_audit and owner_branding_assets');
}

module.exports = { up, down };
