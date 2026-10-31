'use strict';

const { QueryTypes } = require('sequelize');
const { AppError } = require('@ibitplay/common');

const { POINT_EVENT } = require('../lords/pointLedger');
const { TRANSFER_TYPE } = require('../lords/lords.constants');
const { round2 } = require('./accountList');
const {
  readOwnerDirectBalance,
  debitOwnerDirectBalance,
  creditOwnerDirectBalance,
  LEDGER_TYPE,
} = require('../lords/ownerWallet');

/**
 * Points settlement — zip ka `settlePointsFromChild` (`POST /admin/wallet/points/settle`).
 *
 * Parent apne DIRECT child ke saath P/L barabar karta hai:
 *
 *   pending (Client P/L) = child.all_point − child.credit
 *
 *   pending −100 (child haara)  → parent +100 deta hai   (Deposit, points > 0)
 *   pending +100 (child jeeta)  → parent −100 leta hai   (Withdraw, points < 0)
 *
 * Paisa:  child.inr += points,  parent.inr −= points
 * Points: child.all_point += points, child.upper_point += points, parent.down_point −= points
 * (credit nahi badalta, isliye pending 0 ki taraf jaata hai.)
 *
 * Owner aur DIRECT user (parent_staff_id NULL): owner ka paisa Direct User
 * balance (`staff_balances.inr`) se jaata / usi me aata hai, owner ka `credits`
 * row nahi badalta (na inr, na down_point) — wahi rule jo deposit/withdraw me hai.
 */

const fail = (message, status = 400) => new AppError(message, status, 'EXCHANGE_SETTLE_REFUSED');

/** Child dhoondo aur check karo ki actor ka DIRECT child hai. */
async function findDirectChild(models, actor, { accountType, accountId }, transaction) {
  if (accountType === 'staff') {
    const staff = await models.Staff.findByPk(accountId, { attributes: ['id', 'name', 'parent_id'], transaction, raw: true });
    if (!staff) throw fail(`Account ${accountId} not found`, 404);
    if (Number(staff.parent_id) !== Number(actor.id)) {
      throw fail(`${staff.name} is not your direct child, settlement not allowed`, 403);
    }
    return { type: 'staff', id: Number(staff.id), username: staff.name, isDirectUser: false };
  }

  const user = await models.Users.findByPk(accountId, { attributes: ['id', 'name', 'parent_staff_id'], transaction, raw: true });
  if (!user) throw fail(`Account ${accountId} not found`, 404);

  const isDirectUser = user.parent_staff_id == null;
  const mine = isDirectUser ? Boolean(actor.canIssueFunds) : Number(user.parent_staff_id) === Number(actor.id);
  if (!mine) throw fail(`${user.name} is not your direct child, settlement not allowed`, 403);

  return { type: 'user', id: Number(user.id), username: user.name, isDirectUser };
}

/** credits row, lock ke saath (FOR UPDATE). */
async function lockWallet(sequelize, { type, id }, transaction) {
  const column = type === 'user' ? 'uid' : 'staff_id';
  const [row] = await sequelize.query(
    `SELECT id, inr, credit, all_point FROM credits WHERE ${column} = :id FOR UPDATE`,
    { replacements: { id }, type: QueryTypes.SELECT, transaction }
  );
  return row ?? null;
}

/**
 * Settlement karo. Transaction bahar se aata hai.
 *
 * @param {object} p
 * @param {{id, canIssueFunds}} p.actor   parent (login wala)
 * @param {'user'|'staff'} p.accountType  child kaun hai
 * @param {number} p.accountId
 * @param {string|number} p.points        + = parent deta hai, − = parent leta hai
 * @param {string} [p.remark]
 */
async function settlePoints(models, { actor, accountType, accountId, points, remark }, { transaction }) {
  const sequelize = models.Credits.sequelize;

  const delta = round2(points);
  if (Number.isNaN(delta)) throw fail(`Invalid points value "${points}"`);
  if (delta === 0) throw fail('points cannot be 0');

  // 1. Child aur dono wallets.
  const child = await findDirectChild(models, actor, { accountType, accountId }, transaction);
  const parentName = (await models.Staff.findByPk(actor.id, { attributes: ['name'], transaction, raw: true }))?.name ?? String(actor.id);

  const childWallet = await lockWallet(sequelize, child, transaction);
  if (!childWallet) throw fail(`Wallet not found for ${child.username}`, 404);

  // Owner ↔ direct user: owner ka credits wallet bich me nahi aata, Direct User balance aata hai.
  const parentPays = !child.isDirectUser;
  const fromDirectBalance = child.isDirectUser;
  const parentWallet = await lockWallet(sequelize, { type: 'staff', id: actor.id }, transaction);
  if (!parentWallet) throw fail(`Wallet not found for ${parentName}`, 404);

  // 2. all_point ledger se match hona chahiye, warna settlement band (zip jaisa).
  const [{ total }] = await sequelize.query(
    'SELECT COALESCE(SUM(delta), 0) AS total FROM mssports.point_ledger WHERE wallet_id = :walletId',
    { replacements: { walletId: childWallet.id }, type: QueryTypes.SELECT, transaction }
  );
  const ledgerPoint = round2(total);
  const counter = round2(childWallet.all_point);
  if (counter !== ledgerPoint) {
    throw fail(`${child.username} all_point does not match ledger (wallet ${counter}, ledger ${ledgerPoint}), settlement blocked`, 409);
  }

  // 3. Kitna pending hai, aur amount sahi taraf ka hai?
  const pending = round2(counter - round2(childWallet.credit));
  if (pending === 0) throw fail(`${child.username} has no pending settlement`);
  if ((pending > 0 && delta > 0) || (pending < 0 && delta < 0) || Math.abs(delta) > Math.abs(pending)) {
    throw fail('Amount Greater than P/L');
  }

  // 4. Balance check.
  const taking = delta < 0;
  const childInrBefore = round2(childWallet.inr);
  const parentInrBefore = fromDirectBalance
    ? round2(await readOwnerDirectBalance(models, actor.id, { transaction }))
    : round2(parentWallet.inr);
  if (taking && childInrBefore < Math.abs(delta)) {
    throw fail(`${child.username} has only ${childInrBefore} INR, cannot take ${Math.abs(delta)}`);
  }
  if (!taking && parentInrBefore < delta) {
    const which = fromDirectBalance ? 'Direct User balance' : 'INR';
    throw fail(`${parentName} has only ${parentInrBefore} ${which}, cannot pay ${delta}`);
  }

  const childInrAfter = round2(childInrBefore + delta);
  const parentInrAfter = round2(parentInrBefore - delta);
  const allPointAfter = round2(counter + delta);

  // 5. Paisa aur points.
  await sequelize.query(
    `UPDATE credits
        SET inr = inr + :delta, all_point = all_point + :delta, upper_point = upper_point + :delta
      WHERE id = :walletId`,
    { replacements: { delta, walletId: childWallet.id }, transaction }
  );
  if (parentPays) {
    await sequelize.query(
      'UPDATE credits SET inr = inr - :delta, down_point = down_point - :delta WHERE id = :walletId',
      { replacements: { delta, walletId: parentWallet.id }, transaction }
    );
  } else {
    // Owner ↔ direct user: owner ka Direct User wallet, ledger entry ke saath.
    const entry = { type: LEDGER_TYPE.POINTS_SETTLE, userId: child.id, note: remark || 'Points settlement' };
    if (taking) {
      await creditOwnerDirectBalance(models, actor.id, Math.abs(delta), { transaction, entry });
    } else if (!(await debitOwnerDirectBalance(models, actor.id, delta, { transaction, entry }))) {
      throw fail(`${parentName} has not enough Direct User balance to pay ${delta}`);
    }
  }

  // 6. Record: staff_transfers (paisa kahan se kahan gaya).
  const transfer = await models.StaffTransfers.create(
    {
      from_type: taking ? child.type : 'staff',
      from_id: taking ? child.id : actor.id,
      to_type: taking ? 'staff' : child.type,
      to_id: taking ? actor.id : child.id,
      amount: Math.abs(delta).toFixed(2),
      direction: taking ? 'withdraw' : 'deposit',
      transfer_type: TRANSFER_TYPE.POINTS_SETTLE,
      note: remark || 'Points settlement',
      created_at: new Date(),
    },
    { transaction }
  );

  // Player ka apna ledger bhi (taaki uska wallet aur ledger match rahe).
  if (child.type === 'user') {
    await models.CreditsLedger.create(
      {
        user_id: String(child.id),
        currency: 'INR',
        amount: delta.toFixed(2),
        reason: taking ? 'TRANSFER_OUT' : 'TRANSFER_IN',
        description: remark || 'Points settlement',
        balance: childInrAfter.toFixed(2),
        closing: childInrAfter.toFixed(2),
        netamount: 0,
        profit: 0,
        loss: 0,
        commission: 0,
        source_service: 'admin-service',
        meta: { refType: 'STAFF_TRANSFER', refId: String(transfer.id), staffId: String(actor.id), previousBalance: childInrBefore.toFixed(2) },
      },
      { transaction }
    );
    await models.WalletHistory.create(
      {
        uid: child.id,
        username: child.username,
        coin: 'INR',
        operation: taking ? 'debit' : 'credit',
        amount: Math.abs(delta).toFixed(2),
        previous_balance: childInrBefore.toFixed(2),
        new_balance: childInrAfter.toFixed(2),
        description: remark || 'Points settlement',
        transaction_time: new Date(),
      },
      { transaction }
    );
  }

  // 7. Point ledger entry (zip: entry_ref `cashsettle:<id>`, 'Bank Deposite' / 'Bank Withdraw').
  const eventType = taking ? POINT_EVENT.BANK_WITHDRAW : POINT_EVENT.BANK_DEPOSIT;
  const names = taking ? `${child.username}/${parentName}` : `${parentName}/${child.username}`;
  await sequelize.query(
    `INSERT INTO mssports.point_ledger
       (entry_ref, event_type, username, wallet_id, settled_with_wallet_id, delta, all_point_after,
        closing_inr_balance, closing_inr_balance_parent, source_user_id, remark, created_at)
     VALUES
       (:entryRef, :eventType, :username, :walletId, :parentWalletId, :delta, :allPointAfter,
        :closingInr, :closingInrParent, :sourceUserId, :remark, NOW())`,
    {
      replacements: {
        entryRef: `cashsettle:${transfer.id}`,
        eventType,
        username: child.username,
        walletId: childWallet.id,
        parentWalletId: parentWallet.id,
        delta,
        allPointAfter,
        closingInr: childInrAfter,
        closingInrParent: parentInrAfter,
        sourceUserId: child.type === 'user' ? child.id : null,
        remark: `${remark || eventType}#${names}`.slice(0, 255),
      },
      transaction,
    }
  );

  return {
    transferId: String(transfer.id),
    username: child.username,
    points: delta.toFixed(2),
    allPointAfter: allPointAfter.toFixed(2),
    pendingAfter: round2(pending + delta).toFixed(2),
    childBalance: childInrAfter.toFixed(2),
    parentBalance: parentInrAfter.toFixed(2),
  };
}

module.exports = { settlePoints };
