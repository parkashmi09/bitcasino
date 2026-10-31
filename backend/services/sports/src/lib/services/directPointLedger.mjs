// Direct user (koi parent nahi) ka point ledger — `mssports.point_ledger_direct` (migration 116).
//
// Agent system ka `point_ledger` chain ke har wallet ki row likhta hai; direct user ki chain
// nahi hoti, isliye yahan har event ki SIRF EK row — usi user ki, usi currency me jisme bet lagi.
// `credits.all_point` ko ye kabhi nahi chhuta: direct user ka "all point" uska paisa hai, jo
// settlement pehle hi move kar chuka hota hai. `balance_after` = us currency ka wallet balance.
// `entry_ref` unique hai — wahi event dobara aaye to row dobara nahi banti.
import { QueryTypes } from "sequelize";
import { withVoidSuffix } from "../helper/voidLabel.mjs";
import { inrToCurrency } from "../helper/toInr.mjs";

const TABLE = "mssports.point_ledger_direct";

/** User ka `credits.<currency>` balance (column na ho to null) aur naam. */
async function walletOf(db, userId, currency, transaction) {
  const [row] = await db.query(
    `SELECT u.name AS username, to_jsonb(c) ->> :column AS balance
       FROM public.users u LEFT JOIN public.credits c ON c.uid = u.id
      WHERE u.id = :userId`,
    { replacements: { userId, column: currency.toLowerCase() }, type: QueryTypes.SELECT, transaction }
  );
  return row ?? {};
}

/**
 * Ek entry likho. `delta` sign ke saath (jeet +, haar −), `currency` me.
 * @returns {Promise<{ written: boolean }>} written=false: ye entry_ref pehle se hai
 */
async function writeDirectEntry(db, { entryRef, eventType, category, userId, currency, delta, betId = null, sportId = null, gameType = null, remark = null }, { transaction } = {}) {
  const code = String(currency || "INR").toUpperCase().slice(0, 10);
  const wallet = await walletOf(db, userId, code, transaction);
  // `delta` in the coin the bet was placed in (sign kept); no bet → no coin to convert into.
  const [bet] = betId ? await db.query('SELECT original_currency FROM mssports."SportsBet" WHERE id = :betId', { replacements: { betId }, type: QueryTypes.SELECT, transaction }) : [];
  const deltaCurrency = bet ? await inrToCurrency(delta, bet.original_currency || "INR") : null;
  const rows = await db.query(
    `INSERT INTO ${TABLE}
       (entry_ref, event_type, category, user_id, username, currency, delta, delta_currency, balance_after,
        bet_id, sport_id, game_type, remark, created_at)
     VALUES
       (:entryRef, :eventType, :category, :userId, :username, :currency, :delta, :deltaCurrency, :balanceAfter,
        :betId, :sportId, :gameType, :remark, NOW())
     ON CONFLICT (entry_ref) DO NOTHING
     RETURNING id`,
    {
      replacements: {
        entryRef,
        eventType,
        category,
        userId,
        username: wallet.username ?? null,
        currency: code,
        delta: String(delta),
        deltaCurrency: deltaCurrency == null ? null : String(deltaCurrency),
        balanceAfter: wallet.balance ?? null,
        betId,
        sportId: sportId != null ? String(sportId).slice(0, 50) : null,
        gameType: gameType != null ? String(gameType).slice(0, 50) : null,
        remark: remark != null ? String(remark).slice(0, 255) : null
      },
      type: QueryTypes.SELECT,
      transaction
    }
  );
  return { written: rows.length > 0 };
}

/** `originalRef` ki ulti entry `reversalRef` ke naam se — asli row kabhi delete nahi hoti. */
async function reverseDirectEntry(db, { originalRef, reversalRef, eventType, remark }, { transaction } = {}) {
  const [original] = await db.query(`SELECT * FROM ${TABLE} WHERE entry_ref = :originalRef`, {
    replacements: { originalRef },
    type: QueryTypes.SELECT,
    transaction
  });
  if (!original) return { written: false, missing: true };
  return writeDirectEntry(
    db,
    {
      entryRef: reversalRef,
      eventType,
      category: original.category,
      userId: original.user_id,
      currency: original.currency,
      delta: `${String(original.delta).startsWith("-") ? "" : "-"}${String(original.delta).replace(/^-/, "")}`,
      betId: original.bet_id,
      sportId: original.sport_id,
      gameType: original.game_type,
      remark: remark ?? withVoidSuffix(original.remark || "")
    },
    { transaction }
  );
}

/**
 * Settle hone se PEHLE wale void (OPEN_BET, MARKET, FEED_SUSPENDED, AUTO_TIMEOUT) — direct users ki
 * har bet ki ek `VOID` row, delta 0: settle se pehle koi jeet/haar nahi hui thi, sirf exposure
 * chhoota. Child users skip (unka agent ledger alag hai). AFTER_SETTLEMENT yahan nahi — uski
 * ulti entry reverseAllPointHierarchy / deletePointEntries likhte hain.
 * entry_ref `void:bet:SPORTS:<betId>:<voidGroupId>` — wahi void dobara aaye to dobara nahi.
 */
async function writeDirectVoids(db, args, { transaction } = {}) {
  // Savepoint: ledger ki koi galti void ko fail na kare (void ho, entry na bane — log zor se).
  try {
    if (transaction) return await db.transaction({ transaction }, (sp) => writeVoidRows(db, args, sp));
    return await writeVoidRows(db, args, undefined);
  } catch (err) {
    console.error("[pointLedgerDirect] void entry write failed:", args?.voidType, err.message);
    return { written: 0, error: err.message };
  }
}

async function writeVoidRows(db, { voidType, voidGroupId, bets }, transaction) {
  const userIds = [...new Set(bets.map((b) => String(b.user_id)).filter(Boolean))];
  if (!userIds.length) return { written: 0 };
  const direct = await db.query(
    "SELECT id::text AS id FROM public.users WHERE id::text IN (:userIds) AND parent_staff_id IS NULL",
    { replacements: { userIds }, type: QueryTypes.SELECT, transaction }
  );
  const directIds = new Set(direct.map((r) => r.id));
  let written = 0;
  for (const b of bets) {
    if (!directIds.has(String(b.user_id))) continue;
    const what = [b.match_title || b.event_name, b.market_type, b.selection_name || b.selection].filter(Boolean).join(" / ");
    const stake = b.stake_amount ?? b.stake;
    const res = await writeDirectEntry(db, {
      entryRef: `void:bet:SPORTS:${b.id}:${voidGroupId}`,
      eventType: "VOID",
      category: "SPORTS",
      userId: b.user_id,
      currency: b.original_currency || "INR",
      delta: 0,
      betId: b.id,
      sportId: b.sport_id ?? null,
      gameType: b.gtype || b.game_type || null,
      remark: `${voidType} void${what ? ` — ${what}` : ""}${stake != null ? ` (stake ${stake})` : ""}`
    }, { transaction });
    if (res.written) written += 1;
  }
  return { written };
}

/** Entry hi mita do — ab kisi void flow me use nahi hota (direct ledger me sab rehta hai). */
async function deleteDirectEntries(db, entryRef, { transaction } = {}) {
  const rows = await db.query(`DELETE FROM ${TABLE} WHERE entry_ref = :entryRef RETURNING id`, {
    replacements: { entryRef },
    type: QueryTypes.SELECT,
    transaction
  });
  return { deleted: rows.length };
}

export { writeDirectEntry, reverseDirectEntry, writeDirectVoids, deleteDirectEntries };
