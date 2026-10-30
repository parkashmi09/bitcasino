'use strict';

/**
 * The PARENT site's Whitelabel panel (admin modules/whitelabels). Created on every site; only the
 * parent (WHITELABEL_MODE off) writes them.
 *
 * `whitelabels` — one row per copy. Slug and the three domains are unique among the rows not
 *   deleted, so a deleted copy's names can be used again. `link_key` is the copy's
 *   WHITELABEL_LINK_KEY, sealed with the site's secret box (TOTP_ENCRYPTION_KEY). The company
 *   password is kept only as its bcrypt hash, until the setup script has put it in the copy.
 *   `admin_port` / `ports` are written by the setup script.
 *
 * `whitelabel_jobs` — setup / delete runs, picked up by the setup script (scripts/whitelabel/),
 *   with the step it is on and its log.
 *
 * `whitelabel_transfers` — the parent Super Admin's Direct balance → the company's Direct
 *   balance. Debited here first (`pending`), then sent to the copy under `p<id>`, which the copy
 *   applies once however often it is sent. `uncertain` = an attempt had no answer (the copy may
 *   have applied it), so such a row is never refunded automatically.
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS whitelabels (
       id                     SERIAL PRIMARY KEY,
       slug                   VARCHAR(30)   NOT NULL,
       name                   VARCHAR(60)   NOT NULL,
       title                  VARCHAR(70),
       description            VARCHAR(300),
       site_domain            VARCHAR(253)  NOT NULL,
       admin_domain           VARCHAR(253)  NOT NULL,
       api_domain             VARCHAR(253)  NOT NULL,
       template               VARCHAR(40)   NOT NULL,
       palette                JSONB,
       logo                   BYTEA,
       logo_type              VARCHAR(40),
       company_role_name      VARCHAR(40)   NOT NULL,
       company_name           VARCHAR(80)   NOT NULL,
       company_email          VARCHAR(190)  NOT NULL,
       company_password_hash  TEXT,
       link_key               TEXT          NOT NULL,
       admin_port             INTEGER,
       ports                  JSONB,
       status                 VARCHAR(10)   NOT NULL DEFAULT 'queued'
                              CHECK (status IN ('queued', 'creating', 'live', 'failed', 'deleting', 'deleted')),
       maintenance            BOOLEAN       NOT NULL DEFAULT false,
       created_by             INTEGER,
       created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
       updated_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW()
     )`,
    { transaction }
  );
  for (const column of ['slug', 'site_domain', 'admin_domain', 'api_domain']) {
    await sequelize.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS whitelabels_${column}_live ON whitelabels (LOWER(${column})) WHERE status <> 'deleted'`,
      { transaction }
    );
  }

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS whitelabel_jobs (
       id             SERIAL PRIMARY KEY,
       whitelabel_id  INTEGER      NOT NULL REFERENCES whitelabels (id),
       kind           VARCHAR(10)  NOT NULL CHECK (kind IN ('create', 'delete')),
       status         VARCHAR(10)  NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
       step           VARCHAR(120),
       log            TEXT         NOT NULL DEFAULT '',
       created_by     INTEGER,
       created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
       started_at     TIMESTAMPTZ,
       finished_at    TIMESTAMPTZ
     )`,
    { transaction }
  );
  await sequelize.query(`CREATE INDEX IF NOT EXISTS whitelabel_jobs_queued ON whitelabel_jobs (id) WHERE status = 'queued'`, { transaction });

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS whitelabel_transfers (
       id                 BIGSERIAL PRIMARY KEY,
       whitelabel_id      INTEGER      NOT NULL REFERENCES whitelabels (id),
       amount             NUMERIC      NOT NULL CHECK (amount > 0),
       note               VARCHAR(200),
       status             VARCHAR(10)  NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'refunded')),
       uncertain          BOOLEAN      NOT NULL DEFAULT false,
       attempts           INTEGER      NOT NULL DEFAULT 0,
       error              TEXT,
       staff_id           INTEGER      NOT NULL,
       staff_transfer_id  BIGINT,
       created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
       updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
     )`,
    { transaction }
  );
  await sequelize.query(`CREATE INDEX IF NOT EXISTS whitelabel_transfers_wl ON whitelabel_transfers (whitelabel_id, id DESC)`, { transaction });
  logger?.info('Created whitelabels, whitelabel_jobs and whitelabel_transfers');
}

async function down({ sequelize, transaction }) {
  await sequelize.query(`DROP TABLE IF EXISTS whitelabel_transfers`, { transaction });
  await sequelize.query(`DROP TABLE IF EXISTS whitelabel_jobs`, { transaction });
  await sequelize.query(`DROP TABLE IF EXISTS whitelabels`, { transaction });
}

module.exports = { up, down };
