'use strict';

/**
 * `mssports.point_ledger_direct` = EVERY balance change of a direct user (user, 2026-10-17).
 *
 * Migration 116 kept settlement P/L rows (sports) and a net row per casino round. The rule now:
 * a direct user's (`users.parent_staff_id IS NULL`) wallet moves — admin credit/debit, deposit,
 * withdrawal, bonus, bet stake, payout, refund, void, swap, any currency — and ONE row lands here
 * with the real move (`delta`) and the balance right after (`balance_after`). So the ledger always
 * sums to the wallet.
 *
 * A trigger on `public.credits` (money columns) and `public.wallet_balances` (custom coins) writes
 * the row, so no path can skip it. What happened comes from the caller: `directLedgerContext()`
 * (packages/common/src/directLedger.js) sets `parker.ledger` for the transaction just before the
 * update; the trigger reads it for event_type / category / bet / remark and clears it, so one label
 * describes one update. No label → event 'BALANCE_CHANGE', category 'OTHER' (still recorded).
 *
 * Existing rows (116 semantics) are replaced by one OPENING row per direct user per non-zero
 * currency, so the ledger sums to today's balance from here on. Idempotent.
 */

const MONEY_COLUMNS = [
  'btc', 'eth', 'ltc', 'bch', 'usdt', 'trx', 'doge', 'ada', 'xrp', 'bnb', 'usdp', 'nexo', 'mkr', 'tusd',
  'usdc', 'busd', 'nc', 'inr', 'shib', 'matic', 'sc', 'mvr', 'bjb', 'aed', 'npr', 'pkr', 'eur', 'bdt',
];

const INSERT_ROW = `
  INSERT INTO mssports.point_ledger_direct
    (entry_ref, ref, source, event_type, category, user_id, username, currency, delta, balance_after,
     bet_id, sport_id, game_type, remark, created_at)
  VALUES
    ('bal:' || nextval('mssports.point_ledger_direct_bal_seq'), ctx->>'ref', ctx->>'source',
     COALESCE(NULLIF(ctx->>'eventType', ''), 'BALANCE_CHANGE'), COALESCE(NULLIF(ctx->>'category', ''), 'OTHER'),
     p_uid, uname, upper(p_cur), p_delta, p_after,
     CASE WHEN ctx->>'betId' ~ '^[0-9]{1,18}$' THEN (ctx->>'betId')::bigint END,
     left(ctx->>'sportId', 50), left(ctx->>'gameType', 50), left(ctx->>'remark', 255), NOW())`;

async function up({ sequelize, transaction }) {
  const q = (sql) => sequelize.query(sql, { transaction });

  await q(`ALTER TABLE mssports.point_ledger_direct ADD COLUMN IF NOT EXISTS ref VARCHAR(160)`);
  await q(`ALTER TABLE mssports.point_ledger_direct ADD COLUMN IF NOT EXISTS source VARCHAR(40)`);
  await q(`CREATE SEQUENCE IF NOT EXISTS mssports.point_ledger_direct_bal_seq`);

  // One row for one direct user's move in one currency. Reads + clears the caller's label.
  await q(`
    CREATE OR REPLACE FUNCTION mssports.direct_ledger_write(p_uid BIGINT, p_cur TEXT, p_delta NUMERIC, p_after NUMERIC)
    RETURNS void LANGUAGE plpgsql AS $$
    DECLARE
      ctx JSONB;
      uname TEXT;
      parent BIGINT;
      found_user BOOLEAN;
    BEGIN
      IF p_uid IS NULL OR p_delta = 0 THEN RETURN; END IF;
      SELECT name, parent_staff_id, TRUE INTO uname, parent, found_user FROM public.users WHERE id = p_uid;
      IF found_user IS NOT TRUE OR parent IS NOT NULL THEN RETURN; END IF;  -- agent users: point_ledger
      BEGIN
        ctx := NULLIF(current_setting('parker.ledger', true), '')::jsonb;
      EXCEPTION WHEN others THEN ctx := NULL;
      END;
      -- A label is for its own user only.
      IF ctx IS NOT NULL AND ctx ? 'userId' AND ctx->>'userId' <> p_uid::text THEN ctx := NULL; END IF;
      ctx := COALESCE(ctx, '{}'::jsonb);
      ${INSERT_ROW};
    END $$`);

  await q(`
    CREATE OR REPLACE FUNCTION mssports.direct_ledger_credits() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
      o JSONB := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
      n JSONB := to_jsonb(NEW);
      c TEXT;
      ov NUMERIC;
      nv NUMERIC;
      wrote BOOLEAN := FALSE;
    BEGIN
      IF NEW.uid IS NULL OR NEW.staff_id IS NOT NULL THEN RETURN NEW; END IF;
      FOREACH c IN ARRAY ARRAY['${MONEY_COLUMNS.join("','")}'] LOOP
        nv := COALESCE((n->>c)::numeric, 0);
        ov := COALESCE((o->>c)::numeric, 0);
        IF nv <> ov THEN
          PERFORM mssports.direct_ledger_write(NEW.uid, c, nv - ov, nv);
          wrote := TRUE;
        END IF;
      END LOOP;
      IF wrote THEN PERFORM set_config('parker.ledger', '', true); END IF;
      RETURN NEW;
    END $$`);

  await q(`
    CREATE OR REPLACE FUNCTION mssports.direct_ledger_wallet_balances() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
      ov NUMERIC := CASE WHEN TG_OP = 'UPDATE' THEN COALESCE(OLD.balance, 0) ELSE 0 END;
      nv NUMERIC := COALESCE(NEW.balance, 0);
    BEGIN
      IF nv <> ov THEN
        PERFORM mssports.direct_ledger_write(NEW.uid, NEW.currency, nv - ov, nv);
        PERFORM set_config('parker.ledger', '', true);
      END IF;
      RETURN NEW;
    END $$`);

  await q(`DROP TRIGGER IF EXISTS direct_ledger_credits ON public.credits`);
  await q(`CREATE TRIGGER direct_ledger_credits AFTER INSERT OR UPDATE ON public.credits
             FOR EACH ROW EXECUTE FUNCTION mssports.direct_ledger_credits()`);
  await q(`DROP TRIGGER IF EXISTS direct_ledger_wallet_balances ON public.wallet_balances`);
  await q(`CREATE TRIGGER direct_ledger_wallet_balances AFTER INSERT OR UPDATE ON public.wallet_balances
             FOR EACH ROW EXECUTE FUNCTION mssports.direct_ledger_wallet_balances()`);

  // Start from today's balances: 116's P/L rows do not mean "balance change", so they go, and one
  // OPENING row per direct user per non-zero currency makes the ledger sum to the wallet.
  const [{ opened }] = await sequelize.query(
    `SELECT COUNT(*)::int AS opened FROM mssports.point_ledger_direct WHERE event_type = 'OPENING'`,
    { transaction, type: 'SELECT' }
  );
  if (opened === 0) {
    await q(`DELETE FROM mssports.point_ledger_direct`);
    for (const c of MONEY_COLUMNS) {
      await q(`
        INSERT INTO mssports.point_ledger_direct
          (entry_ref, source, event_type, category, user_id, username, currency, delta, balance_after, remark, created_at)
        SELECT 'opening:${c}:' || u.id, 'migration-117', 'OPENING', 'OPENING', u.id, u.name, '${c.toUpperCase()}',
               c.${c}, c.${c}, 'Opening balance', NOW()
          FROM public.credits c JOIN public.users u ON u.id = c.uid
         WHERE u.parent_staff_id IS NULL AND c.staff_id IS NULL AND COALESCE(c.${c}, 0) <> 0
        ON CONFLICT (entry_ref) DO NOTHING`);
    }
    await q(`
      INSERT INTO mssports.point_ledger_direct
        (entry_ref, source, event_type, category, user_id, username, currency, delta, balance_after, remark, created_at)
      SELECT 'opening:wb:' || w.currency || ':' || u.id, 'migration-117', 'OPENING', 'OPENING', u.id, u.name,
             upper(w.currency), w.balance, w.balance, 'Opening balance', NOW()
        FROM public.wallet_balances w JOIN public.users u ON u.id = w.uid
       WHERE u.parent_staff_id IS NULL AND COALESCE(w.balance, 0) <> 0
      ON CONFLICT (entry_ref) DO NOTHING`);
  }
}

async function down({ sequelize, transaction }) {
  const q = (sql) => sequelize.query(sql, { transaction });
  await q(`DROP TRIGGER IF EXISTS direct_ledger_credits ON public.credits`);
  await q(`DROP TRIGGER IF EXISTS direct_ledger_wallet_balances ON public.wallet_balances`);
  await q(`DROP FUNCTION IF EXISTS mssports.direct_ledger_credits()`);
  await q(`DROP FUNCTION IF EXISTS mssports.direct_ledger_wallet_balances()`);
  await q(`DROP FUNCTION IF EXISTS mssports.direct_ledger_write(BIGINT, TEXT, NUMERIC, NUMERIC)`);
}

module.exports = { up, down, MONEY_COLUMNS };
