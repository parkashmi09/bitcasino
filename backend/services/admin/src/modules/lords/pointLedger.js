'use strict';

const { QueryTypes } = require('sequelize');
const { money } = require('@ibitplay/common');

/**
 * Point ledger — zip (msadmin) jaisa hisaab.
 *
 * Jab bhi parent apne child ko paisa deta hai ya child se leta hai, child ke
 * wallet (`credits` row) me:
 *
 *   credit    += delta     (parent ne ab tak kitna diya, net)
 *   all_point += delta     (point ledger ka jod)
 *
 * aur `mssports.point_ledger` me ek entry banti hai (wallet_id = credits.id).
 * Parent ka sirf `inr` badalta hai, uske points nahi — zip me bhi aisa hi hai.
 *
 * Entries kabhi update/delete nahi hoti. `(wallet_id, entry_ref)` unique hai,
 * isliye same transfer ki entry do baar nahi lag sakti.
 */

/** Zip ke `constants/pointLedger.js` wale naam. */
const POINT_EVENT = Object.freeze({
  CREDIT: 'Credit', // parent ne child ko diya (+)
  DEBIT: 'Debit', // parent ne child se liya (−)
  BANK_DEPOSIT: 'Bank Deposite', // owner ne DIRECT user ko diya — owner ke Direct User balance (staff_balances) se
  BANK_WITHDRAW: 'Bank Withdraw', // owner ne DIRECT user se liya — owner ke Direct User balance me gaya
  USER_CREATION: 'User creation', // account bante waqt parent ka diya opening credit (TENEXCH createUserUnderParent / createStaff)
});

/** entry_ref — transfer ki id se, taaki entry dobara na lage. */
const pointEntryRef = Object.freeze({
  deposit: (transferId) => `deposit:${transferId}`,
  withdraw: (transferId) => `withdraw:${transferId}`,
  // Opening credit — child wallet ki pehli entry (TENEXCH `open:<walletId>`).
  opening: (walletId) => `open:${walletId}`,
});

/**
 * TENEXCH ka rule: settlement points (`upper_point + down_point`) aage nahi diye ja sakte —
 * parent ka deposit / child staff ka withdraw sirf `inr − settlement points` tak.
 * `credits` row pe SQL condition (`:amount` replacement chahiye).
 */
const SPENDABLE_SQL = 'inr - GREATEST(COALESCE(upper_point, 0) + COALESCE(down_point, 0), 0) >= :amount';

/** Player ya staff ka wallet (credits row) — id, inr aur naam. */
async function findWallet(models, party, transaction) {
  if (party.type === 'user') {
    const [wallet, user] = await Promise.all([
      models.Credits.findOne({ where: { uid: party.id }, attributes: ['id', 'inr'], transaction, raw: true }),
      models.Users.findByPk(party.id, { attributes: ['name'], transaction, raw: true }),
    ]);
    return wallet && { id: wallet.id, inr: wallet.inr, username: user?.name ?? String(party.id) };
  }

  const [wallet, staff] = await Promise.all([
    models.StaffCredits.findOne({ where: { staff_id: party.id }, attributes: ['id', 'inr'], transaction, raw: true }),
    models.Staff.findByPk(party.id, { attributes: ['name'], transaction, raw: true }),
  ]);
  return wallet && { id: wallet.id, inr: wallet.inr, username: staff?.name ?? String(party.id) };
}

/**
 * Child ke wallet me point entry lagao.
 *
 * Paisa (`inr`) pehle hi move ho chuka hona chahiye — ye function sirf
 * points aur ledger likhta hai, usi transaction me.
 *
 * @param {object} p
 * @param {{type:'user'|'staff', id}} p.child   jiske points badlenge
 * @param {{type:'user'|'staff', id}} p.parent  jiske saath len-den hua
 * @param {string} p.amount     hamesha positive decimal string
 * @param {boolean} p.isDeposit true = child ko mila, false = child se gaya
 * @param {string|number} p.transferId  staff_transfers.id
 * @param {string} [p.eventType]  default Credit / Debit
 * @param {string} [p.remark]
 * @param {boolean} [p.opening] account ka opening credit: event 'User creation', entry_ref `open:<walletId>`
 */
async function addPointEntry(models, { child, parent, amount, isDeposit, transferId, eventType, remark, opening = false }, { transaction }) {
  const childWallet = await findWallet(models, child, transaction);
  const parentWallet = await findWallet(models, parent, transaction);
  if (!childWallet || !parentWallet) return null; // wallet hi nahi hai — kuch likhne ko nahi

  const delta = isDeposit
    ? money.toDecimalString(money.toMinor(amount))
    : money.toDecimalString(-money.toMinor(amount));

  // 1. Child ke points badlo, naya all_point wapas lo.
  const [updated] = await models.Credits.sequelize.query(
    `UPDATE credits
        SET credit = credit + :delta, all_point = all_point + :delta
      WHERE id = :walletId
      RETURNING all_point`,
    { replacements: { delta, walletId: childWallet.id }, type: QueryTypes.SELECT, transaction }
  );

  // 2. Ledger entry (zip ka PointLedger.create).
  await models.Credits.sequelize.query(
    `INSERT INTO mssports.point_ledger
       (entry_ref, event_type, username, wallet_id, settled_with_wallet_id, delta, all_point_after,
        closing_inr_balance, closing_inr_balance_parent, source_user_id, remark, created_at)
     VALUES
       (:entryRef, :eventType, :username, :walletId, :parentWalletId, :delta, :allPointAfter,
        :closingInr, :closingInrParent, :sourceUserId, :remark, NOW())`,
    {
      replacements: {
        entryRef: opening ? pointEntryRef.opening(childWallet.id) : isDeposit ? pointEntryRef.deposit(transferId) : pointEntryRef.withdraw(transferId),
        eventType: eventType ?? (opening ? POINT_EVENT.USER_CREATION : isDeposit ? POINT_EVENT.CREDIT : POINT_EVENT.DEBIT),
        username: childWallet.username,
        walletId: childWallet.id,
        parentWalletId: parentWallet.id,
        delta,
        allPointAfter: updated?.all_point ?? null,
        closingInr: childWallet.inr ?? 0,
        closingInrParent: parentWallet.inr ?? 0,
        sourceUserId: child.type === 'user' ? child.id : null,
        // TENEXCH: "#bhejne-wala/paane-wala" — deposit pe parent/child, withdraw pe child/parent
        // (Credit History isi se "Super User" padhta hai).
        remark: `${remark ?? ''}#${isDeposit ? `${parentWallet.username}/${childWallet.username}` : `${childWallet.username}/${parentWallet.username}`}`.slice(0, 255),
      },
      transaction,
    }
  );

  return { walletId: childWallet.id, delta, allPointAfter: updated?.all_point ?? null };
}

module.exports = { addPointEntry, POINT_EVENT, pointEntryRef, SPENDABLE_SQL };
