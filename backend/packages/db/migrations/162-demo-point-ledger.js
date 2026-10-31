'use strict';

/**
 * A demo account's balance moves go to `mssports.point_ledger`, not the direct users' ledger
 * (user, 2026-10-27 — TENEXCH's demo user sits under `demo_owner` and keeps a point_ledger).
 *
 * `direct_ledger_write` (migration 117: the trigger on `credits` / `wallet_balances`) wrote every
 * move of a user with no `parent_staff_id` into `point_ledger_direct` — a demo account included,
 * since on the platform it has no staff owner. Now a demo (`users.is_demo`) gets the same row in
 * `point_ledger` instead: `wallet_id` = its `public.credits.id` (what the agent statement reads),
 * `source_user_id` = the demo (what the demo cleanup deletes by), same label, delta and balance.
 * Everything else in the function is unchanged. `down` restores 117's function.
 */
const LABEL = `
      BEGIN
        ctx := NULLIF(current_setting('parker.ledger', true), '')::jsonb;
      EXCEPTION WHEN others THEN ctx := NULL;
      END;
      -- A label is for its own user only.
      IF ctx IS NOT NULL AND ctx ? 'userId' AND ctx->>'userId' <> p_uid::text THEN ctx := NULL; END IF;
      ctx := COALESCE(ctx, '{}'::jsonb);`;

const DIRECT_ROW = `
      INSERT INTO mssports.point_ledger_direct
        (entry_ref, ref, source, event_type, category, user_id, username, currency, delta, balance_after,
         bet_id, sport_id, game_type, remark, created_at)
      VALUES
        ('bal:' || nextval('mssports.point_ledger_direct_bal_seq'), ctx->>'ref', ctx->>'source',
         COALESCE(NULLIF(ctx->>'eventType', ''), 'BALANCE_CHANGE'), COALESCE(NULLIF(ctx->>'category', ''), 'OTHER'),
         p_uid, uname, upper(p_cur), p_delta, p_after,
         CASE WHEN ctx->>'betId' ~ '^[0-9]{1,18}$' THEN (ctx->>'betId')::bigint END,
         left(ctx->>'sportId', 50), left(ctx->>'gameType', 50), left(ctx->>'remark', 255), NOW());`;

const fn = (demoBranch) => `
  CREATE OR REPLACE FUNCTION mssports.direct_ledger_write(p_uid BIGINT, p_cur TEXT, p_delta NUMERIC, p_after NUMERIC)
  RETURNS void LANGUAGE plpgsql AS $$
    DECLARE
      ctx JSONB;
      uname TEXT;
      parent BIGINT;
      demo BOOLEAN;
      found_user BOOLEAN;
    BEGIN
      IF p_uid IS NULL OR p_delta = 0 THEN RETURN; END IF;
      SELECT name, parent_staff_id, is_demo, TRUE INTO uname, parent, demo, found_user FROM public.users WHERE id = p_uid;
      IF found_user IS NOT TRUE OR parent IS NOT NULL THEN RETURN; END IF;  -- agent users: point_ledger
      ${LABEL}
      ${demoBranch}
      ${DIRECT_ROW}
    END $$`;

const DEMO_BRANCH = `
      IF demo THEN
        INSERT INTO mssports.point_ledger
          (entry_ref, event_type, category, username, wallet_id, source_user_id, delta, all_point_after,
           closing_inr_balance, bet_id, sport_id, game_type, remark, delta_currency, created_at)
        VALUES
          ('demo:' || nextval('mssports.point_ledger_direct_bal_seq'),
           COALESCE(NULLIF(ctx->>'eventType', ''), 'BALANCE_CHANGE'), COALESCE(NULLIF(ctx->>'category', ''), 'OTHER'),
           uname, (SELECT id FROM public.credits WHERE uid = p_uid)::int, p_uid, p_delta, p_after,
           CASE WHEN upper(p_cur) = 'INR' THEN p_after END,
           CASE WHEN ctx->>'betId' ~ '^[0-9]{1,18}$' THEN (ctx->>'betId')::bigint END,
           left(ctx->>'sportId', 50), left(ctx->>'gameType', 50), left(ctx->>'remark', 255), p_delta, NOW());
        RETURN;
      END IF;`;

async function up({ sequelize, transaction }) {
  await sequelize.query(fn(DEMO_BRANCH), { transaction });
}

async function down({ sequelize, transaction }) {
  await sequelize.query(fn(''), { transaction });
}

module.exports = { up, down };
