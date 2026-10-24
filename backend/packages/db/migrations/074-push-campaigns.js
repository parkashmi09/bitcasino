'use strict';

/**
 * OneSignal web push: campaigns, notification images, per-event templates and
 * the prompt settings.
 *
 *   push_campaigns  one row per composed push (draft → scheduled → sending →
 *                   sent | failed | cancelled). `accepted` is what OneSignal
 *                   ACCEPTED, never "delivered": OneSignal delivers async.
 *   push_images     uploaded notification images, bytes in the row like
 *                   banners (migration 027). Served publicly so OneSignal can
 *                   fetch them: GET /api/v1/admin/push/images/<id>-<tag>.<ext>
 *   push_templates  the operator's copy for an automatic event push
 *                   (deposit approved, VIP level-up, …), keyed by the
 *                   notification kind. No row = the built-in copy.
 *   push_settings   small JSON settings (the soft-ask prompt copy, the public
 *                   origin images are served from).
 */
async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS push_campaigns (
       id             BIGSERIAL PRIMARY KEY,
       name           VARCHAR(120),
       title          VARCHAR(200) NOT NULL,
       body           TEXT NOT NULL,
       image_url      TEXT,
       icon_url       TEXT,
       badge_url      TEXT,
       url            TEXT,
       buttons        JSONB NOT NULL DEFAULT '[]'::jsonb,
       data           JSONB,
       priority       VARCHAR(10) NOT NULL DEFAULT 'normal',
       ttl_seconds    INTEGER,
       topic          VARCHAR(64),
       audience       JSONB NOT NULL,
       inbox          BOOLEAN NOT NULL DEFAULT TRUE,
       status         VARCHAR(16) NOT NULL DEFAULT 'draft',
       send_at        TIMESTAMPTZ,
       sent_at        TIMESTAMPTZ,
       cancelled_at   TIMESTAMPTZ,
       onesignal_ids  JSONB NOT NULL DEFAULT '[]'::jsonb,
       recipients     INTEGER NOT NULL DEFAULT 0,
       accepted       INTEGER NOT NULL DEFAULT 0,
       inbox_rows     INTEGER NOT NULL DEFAULT 0,
       error          TEXT,
       created_by     BIGINT,
       updated_by     BIGINT,
       created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       CONSTRAINT push_campaigns_status_chk
         CHECK (status IN ('draft','scheduled','sending','sent','failed','cancelled'))
     )`,
    { transaction }
  );
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS ix_push_campaigns_due ON push_campaigns (send_at) WHERE status = 'scheduled'`,
    { transaction }
  );
  await sequelize.query('CREATE INDEX IF NOT EXISTS ix_push_campaigns_created ON push_campaigns (created_at DESC)', {
    transaction,
  });

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS push_images (
       id            BIGSERIAL PRIMARY KEY,
       tag           VARCHAR(16) NOT NULL,
       content_type  VARCHAR(40) NOT NULL,
       byte_size     INTEGER NOT NULL,
       width         INTEGER,
       height        INTEGER,
       data          BYTEA NOT NULL,
       created_by    BIGINT,
       created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    { transaction }
  );

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS push_templates (
       kind        VARCHAR(40) PRIMARY KEY,
       enabled     BOOLEAN NOT NULL DEFAULT TRUE,
       title       VARCHAR(200) NOT NULL,
       body        TEXT NOT NULL,
       image_url   TEXT,
       url         TEXT,
       updated_by  BIGINT,
       updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    { transaction }
  );

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS push_settings (
       key         VARCHAR(40) PRIMARY KEY,
       value       JSONB NOT NULL,
       updated_by  BIGINT,
       updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    { transaction }
  );

  logger?.info('push_campaigns, push_images, push_templates, push_settings created');
}

async function down({ sequelize, transaction }) {
  for (const table of ['push_settings', 'push_templates', 'push_images', 'push_campaigns']) {
    await sequelize.query(`DROP TABLE IF EXISTS ${table}`, { transaction });
  }
}

module.exports = { up, down };
