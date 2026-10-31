'use strict';

const { QueryTypes } = require('sequelize');
const { money } = require('@ibitplay/common');
const { creditStaffFloat, insufficientFunds } = require('./staffFloat');
const { TRANSFER_TYPE } = require('./lords.constants');

/**
 * Owner (Super Admin, level 1) ke DO balance hain:
 *
 *   Agent System balance → `credits.inr` (user_type 'OWNER', migration 099)
 *     Sirf children ke liye: staff/agent aur parent wale players.
 *
 *   Direct User balance → `staff_balances.inr` (owner ki row)
 *     Sirf DIRECT users ke liye (khud signup kiya, parent_staff_id NULL).
 *
 * Rules:
 *
 *   1. Owner khud apne Agent System balance me add karta hai → `addOwnerBalance`
 *      (inr + credit + all_point badhte hain, point ledger me "Credit" — zip jaisa).
 *
 *   2. Owner khud apne Direct User balance me add karta hai → `addOwnerDirectBalance`
 *      (`staff_balances.inr` badhta hai, staff_transfers me 'owner_direct_topup').
 *
 *   3. Owner apne child ko deta hai → `credits.inr` se katta hai (staffFloat).
 *
 *   4. Owner DIRECT user ko deta hai → `staff_balances.inr` se katta hai;
 *      direct user se leta hai → wapas `staff_balances.inr` me jaata hai.
 *      Agent System balance (credits) is len-den me nahi aata.
 *      History: transfer_type 'direct', point ledger 'Bank Deposite' / 'Bank Withdraw'.
 */

/** Direct User balance kam pada. */
const insufficientDirectBalance = (details = {}) =>
  insufficientFunds(
    { party: 'owner_direct', ...details },
    'There is not enough in your Direct User balance to cover this'
  );

const toDecimal = (amount) => money.toDecimalString(money.toMinor(amount));

/** Owner ka Direct User balance (`staff_balances.inr`), decimal string. Row na ho to 0. */
async function readOwnerDirectBalance(models, ownerId, { transaction } = {}) {
  const row = await models.StaffBalances.findOne({ where: { staff_id: ownerId }, attributes: ['inr'], transaction, raw: true });
  return money.toDecimalString(money.toMinorQuantised(row?.inr ?? '0'));
}

/** Ledger ki entry types (`owner_direct_ledger.entry_type`). */
const LEDGER_TYPE = Object.freeze({
  ADD: 'add', // owner ne khud wallet me daala
  USER_DEPOSIT: 'user_deposit', // direct user ko diya
  USER_WITHDRAW: 'user_withdraw', // direct user se liya
  POINTS_SETTLE: 'points_settle', // direct user ke saath points settle
  WHITELABEL_TOPUP: 'whitelabel_topup', // whitelabel company: parent site ne bheja
  TO_AGENT_SYSTEM: 'to_agent_system', // whitelabel company: Agent System balance me le gaya
  TO_WHITELABEL: 'to_whitelabel', // parent: whitelabel company ko bheja
  WHITELABEL_REFUND: 'whitelabel_refund', // parent: copy ne mana kiya, wapas aaya
});

/**
 * Wallet ke har badlav pe ledger row — usi transaction me, taaki wallet aur ledger
 * kabhi alag na hon. `after` DB ka naya balance hai, `before` usi se nikalte hain.
 * `entry` = { type, userId, note, currency?, currencyAmount?, rate? }.
 */
async function writeLedger(models, { ownerId, direction, amount, after, entry = {} }, { transaction }) {
  const afterMinor = money.toMinorQuantised(after);
  const amountMinor = money.toMinor(amount);
  const beforeMinor = direction === 'credit' ? afterMinor - amountMinor : afterMinor + amountMinor;

  await models.StaffBalances.sequelize.query(
    `INSERT INTO owner_direct_ledger
       (owner_id, entry_type, direction, amount, balance_before, balance_after, user_id, note,
        currency, currency_amount, rate, created_at)
     VALUES (:ownerId, :type, :direction, :amount, :before, :after, :userId, :note,
        :currency, :currencyAmount, :rate, NOW())`,
    {
      replacements: {
        ownerId,
        type: entry.type ?? (direction === 'credit' ? LEDGER_TYPE.ADD : LEDGER_TYPE.USER_DEPOSIT),
        direction,
        amount,
        before: money.toDecimalString(beforeMinor),
        after: money.toDecimalString(afterMinor),
        userId: entry.userId ?? null,
        note: entry.note ? String(entry.note).slice(0, 255) : null,
        // Direct User Wallet: user ko kis currency me gaya (INR value upar `amount` me).
        currency: entry.currency ?? null,
        currencyAmount: entry.currencyAmount ?? null,
        rate: entry.rate ?? null,
      },
      transaction,
    }
  );
}

/**
 * Direct User balance se `amount` kaato. Guard `inr >= amount` UPDATE ke andar
 * hai (Postgres row lock), isliye do request saath me bhi minus me nahi le ja sakti.
 * `entry` = ledger ke liye { type, userId, note }.
 *
 * @returns {Promise<boolean>} false = balance kam hai, kuch nahi likha.
 */
async function debitOwnerDirectBalance(models, ownerId, amount, { transaction, entry } = {}) {
  const decimal = toDecimal(amount);
  const rows = await models.StaffBalances.sequelize.query(
    'UPDATE staff_balances SET inr = inr - :amount WHERE staff_id = :ownerId AND inr >= :amount RETURNING inr',
    { replacements: { amount: decimal, ownerId }, type: QueryTypes.SELECT, transaction }
  );
  if (!rows.length) return false;

  await writeLedger(models, { ownerId, direction: 'debit', amount: decimal, after: rows[0].inr, entry }, { transaction });
  return true;
}

/** Direct User balance me `amount` jodo (row na ho to banao). `entry` = ledger ke liye. */
async function creditOwnerDirectBalance(models, ownerId, amount, { transaction, entry } = {}) {
  const decimal = toDecimal(amount);
  const [row] = await models.StaffBalances.sequelize.query(
    `INSERT INTO staff_balances (staff_id, inr) VALUES (:ownerId, :amount)
     ON CONFLICT (staff_id) DO UPDATE SET inr = staff_balances.inr + EXCLUDED.inr
     RETURNING inr`,
    { replacements: { amount: decimal, ownerId }, type: QueryTypes.SELECT, transaction }
  );

  await writeLedger(models, { ownerId, direction: 'credit', amount: decimal, after: row.inr, entry }, { transaction });
}

/**
 * Owner ke Direct User wallet ka ledger, naya pehle. Direct user ka naam bhi saath me.
 * `from` / `to` = Date (optional).
 */
async function listOwnerDirectLedger(models, ownerId, { limit = 25, offset = 0, from, to } = {}) {
  const where = ['l.owner_id = :ownerId'];
  if (from) where.push('l.created_at >= :from');
  if (to) where.push('l.created_at <= :to');
  const filter = where.join(' AND ');
  const replacements = { ownerId, limit, offset, from: from ?? null, to: to ?? null };

  const rows = await models.StaffBalances.sequelize.query(
    `SELECT l.id, l.entry_type, l.direction, l.amount, l.balance_before, l.balance_after,
            l.user_id, u.name AS username, l.note, l.currency, l.currency_amount, l.rate, l.created_at
       FROM owner_direct_ledger l
       LEFT JOIN users u ON u.id = l.user_id
      WHERE ${filter}
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT :limit OFFSET :offset`,
    { replacements, type: QueryTypes.SELECT }
  );
  const [{ total }] = await models.StaffBalances.sequelize.query(`SELECT COUNT(*)::int AS total FROM owner_direct_ledger l WHERE ${filter}`, {
    replacements,
    type: QueryTypes.SELECT,
  });

  return {
    total,
    rows: rows.map((r) => ({
      id: String(r.id),
      type: r.entry_type,
      direction: r.direction,
      amount: money.fromStored(r.amount),
      balanceBefore: money.fromStored(r.balance_before),
      balanceAfter: money.fromStored(r.balance_after),
      user: r.user_id ? { id: String(r.user_id), name: r.username ?? null } : null,
      note: r.note,
      // User ko kis currency me (sirf Direct User Wallet wali entries me; baaki me null).
      currency: r.currency ?? null,
      currencyAmount: r.currency_amount != null ? money.fromStored(r.currency_amount) : null,
      rate: r.rate != null ? money.fromStored(r.rate) : null,
      createdAt: r.created_at,
    })),
  };
}

/**
 * Owner apne Direct User balance me paisa daalta hai.
 * `staff_transfers` me 'owner_direct_topup' row (from 'system').
 */
async function addOwnerDirectBalance(models, { ownerId, amount, note, conversion }, { transaction }) {
  const decimal = toDecimal(amount);
  // conversion = { currency, currencyAmount, rate } jab owner ne INR ke alawa coin me daala.
  await creditOwnerDirectBalance(models, ownerId, decimal, {
    transaction,
    entry: { type: LEDGER_TYPE.ADD, note: note ?? 'Super Admin added Direct User balance', ...conversion },
  });

  const row = await models.StaffTransfers.create(
    {
      from_type: 'system',
      from_id: 0,
      to_type: 'staff',
      to_id: ownerId,
      amount: decimal,
      direction: 'deposit',
      transfer_type: TRANSFER_TYPE.OWNER_DIRECT_TOPUP,
      note: note ?? 'Super Admin added Direct User balance',
      created_at: new Date(),
    },
    { transaction }
  );

  return {
    transferId: String(row.id),
    amount: decimal,
    balance: money.fromStored(await readOwnerDirectBalance(models, ownerId, { transaction })),
  };
}

/** Ye staff owner (level 1) hai? */
async function isOwnerStaff(models, staffId, { transaction } = {}) {
  const staff = await models.Staff.findByPk(staffId, { attributes: ['role_id'], transaction, raw: true });
  if (!staff) return false;
  const role = await models.Roles.findByPk(staff.role_id, { attributes: ['level'], transaction, raw: true });
  return Number(role?.level) === 1;
}

/** Player direct user hai? (khud signup kiya, koi parent nahi) */
async function isDirectUser(models, userId, { transaction } = {}) {
  const user = await models.Users.findByPk(userId, { attributes: ['parent_staff_id'], transaction, raw: true });
  return Boolean(user) && user.parent_staff_id == null;
}

/**
 * Owner apne wallet me balance add karta hai.
 * `staff_transfers` me 'owner_topup' row banti hai (from 'system'), taaki
 * pata rahe owner ne kab kitna paisa system me daala.
 */
async function addOwnerBalance(models, { ownerId, amount, note }, { transaction }) {
  return creditOwnerAgentSystem(
    models,
    { ownerId, amount, note: note ?? 'Super Admin added balance', remark: note || 'Super Admin add balance', from: { type: 'system', id: 0 }, transferType: TRANSFER_TYPE.OWNER_TOPUP },
    { transaction }
  );
}

/**
 * Whitelabel company: Direct User balance se Agent System balance me. Pehle Direct se kaato
 * (guard UPDATE ke andar), kam pada to kuch nahi likha; phir Agent System me jodo — same transaction.
 * `staff_transfers` me 'direct_to_agent' (from the owner itself).
 */
async function moveOwnerDirectToAgentSystem(models, { ownerId, amount, note }, { transaction }) {
  const decimal = toDecimal(amount);
  const label = note ?? 'Moved from Direct balance to Agent System';
  const debited = await debitOwnerDirectBalance(models, ownerId, decimal, {
    transaction,
    entry: { type: LEDGER_TYPE.TO_AGENT_SYSTEM, note: label },
  });
  if (!debited) throw insufficientDirectBalance({ required: decimal });

  const result = await creditOwnerAgentSystem(
    models,
    { ownerId, amount: decimal, note: label, remark: label, from: { type: 'staff', id: ownerId }, transferType: TRANSFER_TYPE.DIRECT_TO_AGENT },
    { transaction }
  );
  return { ...result, directBalance: money.fromStored(await readOwnerDirectBalance(models, ownerId, { transaction })) };
}

/**
 * Whitelabel company: parent site ka transfer Direct User balance me. `whitelabel_topup` row
 * (from 'whitelabel'). Idempotency caller (whitelabel-link) ke paas hai — ye har call pe jodta hai.
 */
async function addWhitelabelTopup(models, { ownerId, amount, note }, { transaction }) {
  const decimal = toDecimal(amount);
  const label = note ?? 'Balance from the parent site';
  await creditOwnerDirectBalance(models, ownerId, decimal, { transaction, entry: { type: LEDGER_TYPE.WHITELABEL_TOPUP, note: label } });

  const row = await models.StaffTransfers.create(
    {
      from_type: 'whitelabel',
      from_id: 0,
      to_type: 'staff',
      to_id: ownerId,
      amount: decimal,
      direction: 'deposit',
      transfer_type: TRANSFER_TYPE.WHITELABEL_TOPUP,
      note: label,
      created_at: new Date(),
    },
    { transaction }
  );
  return { transferId: String(row.id), amount: decimal, balance: money.fromStored(await readOwnerDirectBalance(models, ownerId, { transaction })) };
}

/** Owner ke Agent System balance (`credits`) me jodo + `staff_transfers` row + point ledger 'Credit'. */
async function creditOwnerAgentSystem(models, { ownerId, amount, note, remark, from, transferType }, { transaction }) {
  const decimal = money.toDecimalString(money.toMinor(amount));

  await creditStaffFloat(models, ownerId, decimal, { transaction });

  const row = await models.StaffTransfers.create(
    {
      from_type: from.type,
      from_id: from.id,
      to_type: 'staff',
      to_id: ownerId,
      amount: decimal,
      direction: 'deposit',
      transfer_type: transferType,
      note,
      created_at: new Date(),
    },
    { transaction }
  );

  // Zip (tenexch bundle) jaisa: owner ka credit aur all_point bhi badhte hain, aur
  // point ledger me 'Credit' entry (koi parent nahi — settled_with_wallet_id NULL).
  const [wallet] = await models.Credits.sequelize.query(
    `UPDATE credits SET credit = credit + :amount, all_point = all_point + :amount
      WHERE staff_id = :ownerId
      RETURNING id, inr, all_point`,
    { replacements: { amount: decimal, ownerId }, type: QueryTypes.SELECT, transaction }
  );
  const staff = await models.Staff.findByPk(ownerId, { attributes: ['name'], transaction, raw: true });
  const username = staff?.name ?? String(ownerId);

  await models.Credits.sequelize.query(
    `INSERT INTO mssports.point_ledger
       (entry_ref, event_type, username, wallet_id, settled_with_wallet_id, delta, all_point_after,
        closing_inr_balance, closing_inr_balance_parent, source_user_id, remark, created_at)
     VALUES (:entryRef, 'Credit', :username, :walletId, NULL, :amount, :allPoint, :inr, NULL, NULL, :remark, NOW())`,
    {
      replacements: {
        entryRef: `deposit:${row.id}`,
        username,
        walletId: wallet.id,
        amount: decimal,
        allPoint: wallet.all_point,
        inr: wallet.inr,
        remark: `${remark}#${username}`.slice(0, 255),
      },
      transaction,
    }
  );

  return { transferId: String(row.id), amount: decimal, balance: money.fromStored(wallet?.inr ?? '0') };
}

module.exports = {
  isOwnerStaff,
  isDirectUser,
  addOwnerBalance,
  addOwnerDirectBalance,
  moveOwnerDirectToAgentSystem,
  addWhitelabelTopup,
  readOwnerDirectBalance,
  debitOwnerDirectBalance,
  creditOwnerDirectBalance,
  listOwnerDirectLedger,
  LEDGER_TYPE,
  insufficientDirectBalance,
};
