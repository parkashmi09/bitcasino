'use strict';

/**
 * Push a player's sports exposure the moment it changes.
 *
 * user-service's state sync (modules/sync) carries `exposure` from `mssports.total_exposures`, and
 * the header shows it on the sports pages. A bet placed, cancelled or settled rewrites that row
 * from sports-service, which cannot reach the player sockets; this trigger sends the same
 * `credits_changed` notification migration 113 uses, so user-service re-pushes the player's state
 * at once instead of on the next 2 s tick. Delivered on COMMIT only.
 */
async function up({ sequelize, transaction }) {
  await sequelize.query(
    `CREATE OR REPLACE FUNCTION realtime_exposure_changed() RETURNS trigger AS $$
     BEGIN
       IF NEW.user_id IS NOT NULL THEN
         PERFORM pg_notify('credits_changed', NEW.user_id::text);
       END IF;
       RETURN NULL;
     END
     $$ LANGUAGE plpgsql`,
    { transaction }
  );
  await sequelize.query('DROP TRIGGER IF EXISTS realtime_exposure_changed ON mssports.total_exposures', { transaction });
  await sequelize.query(
    `CREATE TRIGGER realtime_exposure_changed
       AFTER INSERT OR UPDATE ON mssports.total_exposures
       FOR EACH ROW EXECUTE FUNCTION realtime_exposure_changed()`,
    { transaction }
  );
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP TRIGGER IF EXISTS realtime_exposure_changed ON mssports.total_exposures', { transaction });
  await sequelize.query('DROP FUNCTION IF EXISTS realtime_exposure_changed()', { transaction });
}

module.exports = { up, down };
