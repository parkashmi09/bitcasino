'use strict';

/**
 * Real-time pushes for changes made OUTSIDE user-service.
 *
 * user-service pushes a player's balance (`C.CREDIT`) when its own WalletService moves money, but
 * sports settlement, the casino engines, JSGames / GIS callbacks and several admin screens write
 * `credits` directly, and an operator's lock lands on `users` from admin-service. None of those can
 * reach the player sockets, which live in user-service.
 *
 * So the database says it: a row trigger sends `pg_notify`, which Postgres delivers only when the
 * writing transaction COMMITS (a rolled-back bet pushes nothing). user-service LISTENs
 * (`src/realtime/dbChanges.js`) and pushes to `user:<id>` when that player has a socket open.
 *
 *   credits_changed   payload = users.id   any INSERT / UPDATE of a player's credits row
 *   account_changed   payload = users.id   status or a lock column changed
 *
 * The payload is the id only — the listener reads the current row, so a burst of updates to one
 * player collapses into one push.
 */
async function up({ sequelize, transaction }) {
  await sequelize.query(
    `CREATE OR REPLACE FUNCTION realtime_credits_changed() RETURNS trigger AS $$
     BEGIN
       IF NEW.uid IS NOT NULL THEN
         PERFORM pg_notify('credits_changed', NEW.uid::text);
       END IF;
       RETURN NULL;
     END
     $$ LANGUAGE plpgsql`,
    { transaction }
  );
  await sequelize.query('DROP TRIGGER IF EXISTS realtime_credits_changed ON public.credits', { transaction });
  await sequelize.query(
    `CREATE TRIGGER realtime_credits_changed
       AFTER INSERT OR UPDATE ON public.credits
       FOR EACH ROW EXECUTE FUNCTION realtime_credits_changed()`,
    { transaction }
  );

  await sequelize.query(
    `CREATE OR REPLACE FUNCTION realtime_account_changed() RETURNS trigger AS $$
     BEGIN
       PERFORM pg_notify('account_changed', NEW.id::text);
       RETURN NULL;
     END
     $$ LANGUAGE plpgsql`,
    { transaction }
  );
  await sequelize.query('DROP TRIGGER IF EXISTS realtime_account_changed ON public.users', { transaction });
  await sequelize.query(
    `CREATE TRIGGER realtime_account_changed
       AFTER UPDATE OF status, system_locked, casino_locked, sports_betlocked, withdraw_locked ON public.users
       FOR EACH ROW
       WHEN (OLD.status IS DISTINCT FROM NEW.status
          OR OLD.system_locked IS DISTINCT FROM NEW.system_locked
          OR OLD.casino_locked IS DISTINCT FROM NEW.casino_locked
          OR OLD.sports_betlocked IS DISTINCT FROM NEW.sports_betlocked
          OR OLD.withdraw_locked IS DISTINCT FROM NEW.withdraw_locked)
       EXECUTE FUNCTION realtime_account_changed()`,
    { transaction }
  );
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP TRIGGER IF EXISTS realtime_credits_changed ON public.credits', { transaction });
  await sequelize.query('DROP TRIGGER IF EXISTS realtime_account_changed ON public.users', { transaction });
  await sequelize.query('DROP FUNCTION IF EXISTS realtime_credits_changed()', { transaction });
  await sequelize.query('DROP FUNCTION IF EXISTS realtime_account_changed()', { transaction });
}

module.exports = { up, down };
