// Points roll-up ke liye `public.credits` (Wallets ki jagah) — migration 099 ke baad
// player, staff aur owner sabka wallet `credits` me hai:
//   player → credits.uid,  staff/owner → credits.staff_id,  point_ledger.wallet_id = credits.id
//
// Chain = player ka wallet + uske upar ke saare staff (parent_staff_id → staff.parent_id …).
// Direct user (koi parent nahi) ki chain me sirf wo khud hai — owner ka wallet uske
// len-den me nahi aata (admin-service ka rule).
import { QueryTypes } from "sequelize";

/**
 * Player + upline ke credits rows, neeche se upar.
 * @returns {Promise<Array<{id, uid, staff_id, username, all_point, inr}>>}
 */
async function creditsChain(db, userId, transaction) {
  const [user] = await db.query(
    `SELECT u.id, u.name, u.parent_staff_id, c.id AS wallet_id
       FROM public.users u LEFT JOIN public.credits c ON c.uid = u.id
      WHERE u.id = :userId`,
    { replacements: { userId }, type: QueryTypes.SELECT, transaction }
  );
  if (!user) throw new Error(`user ${userId} not found`);
  if (!user.wallet_id) throw new Error(`wallet not found for user ${userId}`);

  const walletIds = [Number(user.wallet_id)];
  const visited = new Set();
  let staffId = user.parent_staff_id;
  while (staffId && !visited.has(Number(staffId))) {
    visited.add(Number(staffId));
    const [staff] = await db.query(
      `SELECT s.id, s.parent_id, c.id AS wallet_id
         FROM public.staff s LEFT JOIN public.credits c ON c.staff_id = s.id
        WHERE s.id = :staffId`,
      { replacements: { staffId }, type: QueryTypes.SELECT, transaction }
    );
    if (!staff) throw new Error(`staff ${staffId} not found (user ${userId} ki hierarchy)`);
    if (!staff.wallet_id) throw new Error(`wallet not found for staff ${staffId}`);
    walletIds.push(Number(staff.wallet_id));
    staffId = staff.parent_id;
  }
  return walletIds;
}

/**
 * Point ledger sirf agent ke child users (aur unke staff) ka — direct user (koi parent nahi)
 * ka flow bina point ledger ke chalta hai.
 */
async function isChildUser(db, userId, transaction) {
  const [row] = await db.query('SELECT parent_staff_id FROM public.users WHERE id = :userId', {
    replacements: { userId },
    type: QueryTypes.SELECT,
    transaction
  });
  return row?.parent_staff_id != null;
}

/**
 * Wallets ke all_point (+ sports_pts) me `delta` jodo aur naye figures lautao
 * (point_ledger entry ke liye username, all_point, inr).
 */
async function addPoints(db, walletIds, delta, { sportsPts = true, transaction } = {}) {
  await db.query(
    `UPDATE public.credits
        SET all_point = all_point + :delta${sportsPts ? ", sports_pts = sports_pts + :delta" : ""}
      WHERE id IN (:walletIds)`,
    { replacements: { delta, walletIds }, transaction }
  );
  return readWallets(db, walletIds, transaction);
}

/** credits rows + naam (player: users.name, staff: staff.name). */
async function readWallets(db, walletIds, transaction) {
  return db.query(
    `SELECT c.id AS wallet_id, c.uid AS user_id, c.staff_id, c.all_point, c.inr AS inr_balance,
            COALESCE(u.name, s.name) AS username
       FROM public.credits c
       LEFT JOIN public.users u ON u.id = c.uid
       LEFT JOIN public.staff s ON s.id = c.staff_id
      WHERE c.id IN (:walletIds)`,
    { replacements: { walletIds }, type: QueryTypes.SELECT, transaction }
  );
}

export { creditsChain, addPoints, readWallets, isChildUser };
