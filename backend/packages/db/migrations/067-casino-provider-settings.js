'use strict';

/**
 * `casino_provider_settings` — the site admin's say over each lobby provider.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE SWITCH THAT DID NOT SWITCH ANYTHING
 *
 * `gis_providers_new.enabled` is what Casino → Game catalogue → Providers
 * writes, and the screen says "disabling a provider hides every one of its
 * games from the lobby". Nothing reads it. The lobby, search, stats and the
 * launch routes all read `gisgamesnew` / `gis_providers` and never look at the
 * flag, so an operator who switched a provider off saw it stay on the site.
 *
 * This table is the lobby's own switch, and it is enforced where the lobby is
 * served (`games.service.js`) and where a game is launched (`gameEntitlement`).
 * The upstream table is left as it is: it is the aggregator feed's list and the
 * provider sync owns it.
 *
 * ── ONE ROW PER PROVIDER, ONLY ONCE SOMEONE TOUCHES IT ────────────────────
 *
 * No row means "enabled, no logo, the catalogue's own name". A row is written
 * the first time an operator changes something, so a provider the sync adds
 * tomorrow is on by default and needs no backfill here.
 *
 * `provider` is the catalogue's name lowercased and trimmed — how
 * `gisgamesnew.provider` is already written, and what every read compares on.
 *
 * ── THE LOGO LIVES IN THE ROW ────────────────────────────────────────────
 *
 * Bytes in the database, as banners do (migration 027): every service instance
 * can serve it, and a restart or a second server does not lose it. The content
 * type is the SNIFFED one (`@ibitplay/common` imageUpload), never the
 * uploader's claim. `logo_updated_at` versions the public URL, so the image can
 * be cached hard and still change the moment it is replaced.
 * ═════════════════════════════════════════════════════════════════════════
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS casino_provider_settings (
       -- The catalogue's provider name, lowercased and trimmed.
       provider           VARCHAR(190) PRIMARY KEY,

       -- Off: the provider's games leave the lobby, search and stats, and a
       -- launch is refused (GAMES_PROVIDER_DISABLED).
       enabled            BOOLEAN      NOT NULL DEFAULT TRUE,

       -- Optional: what the site shows instead of the raw catalogue name
       -- ("Pragmatic Play" for "pragmatic"). Null shows the name.
       display_name       VARCHAR(80),

       -- Optional: where it sits in the providers strip. Null sorts after every
       -- ordered provider, by name.
       sort_order         INTEGER,

       logo_data          BYTEA,
       logo_content_type  VARCHAR(40),
       logo_byte_size     INTEGER,
       logo_updated_at    TIMESTAMPTZ,

       -- Who last changed it.
       updated_by         VARCHAR(190),

       created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
       updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

       -- A logo is all three or none: a type without bytes would serve an
       -- empty image, and bytes without a type could not be served at all.
       CONSTRAINT casino_provider_settings_logo_whole CHECK (
         (logo_data IS NULL AND logo_content_type IS NULL AND logo_byte_size IS NULL)
         OR (logo_data IS NOT NULL AND logo_content_type IS NOT NULL AND logo_byte_size IS NOT NULL)
       )
     )`,
    { transaction }
  );

  /*
   * Every lobby read asks "which providers are off". A partial index over the
   * disabled ones answers it without touching the logo bytes.
   */
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_casino_provider_settings_disabled
       ON casino_provider_settings (provider) WHERE enabled = FALSE`,
    { transaction }
  );

  logger?.info('Created casino_provider_settings — lobby provider switch, logo and display name');
}

/** Drops the table, and with it every uploaded logo — they live nowhere else. */
async function down({ sequelize, transaction, logger }) {
  await sequelize.query('DROP TABLE IF EXISTS casino_provider_settings', { transaction });
  logger?.warn('casino_provider_settings dropped — provider switches and logos are gone with it');
}

module.exports = { up, down };
