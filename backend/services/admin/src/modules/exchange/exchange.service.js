'use strict';

const { Op, QueryTypes } = require('sequelize');
const { money, AppError } = require('@ibitplay/common');
const { PERMISSIONS, hasPermission } = require('@ibitplay/auth');

const { manageableStaffIds } = require('../staff-directory/staffDirectory.service');
const { assertTransactionPassword } = require('../staff-auth/transactionPassword');
const {
  addOwnerBalance,
  addOwnerDirectBalance,
  moveOwnerDirectToAgentSystem,
  readOwnerDirectBalance,
  listOwnerDirectLedger,
} = require('../lords/ownerWallet');
const { TRANSFER_TYPE } = require('../lords/lords.constants');
const { listChildren } = require('./accountList');
const { DirectWalletService } = require('../direct-wallet/directWallet.service');
const { settlePoints } = require('./pointsSettle');

/**
 * Exchange section (admin panel) — zip (msadmin) ke wallet screens ka backend.
 *
 * Sabka balance `credits` table me hai (migration 099):
 *   owner  → user_type 'OWNER', staff_id
 *   staff  → user_type 'STAFF', staff_id
 *   player → user_type 'USER',  uid
 *
 * Owner ke do balance hain: Agent System (`credits`, children ke liye) aur
 * Direct User (`staff_balances`, sirf direct users ke liye) — `lords/ownerWallet.js`.
 *
 * Yahan sirf padhna hai, aur likhne wale kaam: owner apne dono balance me add kare.
 * Baaki paisa move karne wale raaste pehle jaise hain (staff transfer, refill, adjust).
 */

const onlyOwner = () =>
  new AppError('Only the Super Admin can add balance to their own wallet', 403, 'EXCHANGE_OWNER_ONLY');
const notInTree = () => new AppError('This account is not in your tree', 404, 'EXCHANGE_NOT_IN_YOUR_TREE');
// Whitelabel company (WHITELABEL_MODE): paisa sirf parent site ke transfer se aata hai.
const companyNoSelfFunding = () =>
  new AppError('A whitelabel company cannot add balance to itself; balance comes from the parent site', 403, 'WHITELABEL_NO_SELF_FUNDING');
const onlyWhitelabel = () =>
  new AppError('Moving Direct balance to Agent System is only for a whitelabel company', 403, 'WHITELABEL_ONLY');

/** NUMERIC → "123.45" (2 decimals) — dashboard ke liye. */
const show = (value) => money.fromStored(value ?? '0', { field: 'balance' });

class ExchangeService {
  constructor({ models, db, logger, config }) {
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.config = config;
  }

  get sequelize() {
    return this.models.Credits.sequelize;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Dashboard
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Exchange dashboard — upar ke cards.
   *
   *   myWallet   — login wale ka apna wallet (owner ho to owner ka)
   *   staff      — neeche ke staff/agents: kitne hain, unke paas kitna balance
   *   players    — child players (jinka parent hai) aur direct users (sirf owner dekhta hai)
   *   ownerTopups — owner ne ab tak apne wallet me kitna daala (sirf owner)
   *   recent     — last 10 len-den (tree ke andar)
   */
  async dashboard({ actor }) {
    const staffIds = await this.#treeStaffIds(actor);
    const belowMe = staffIds.filter((id) => id !== Number(actor.id));

    const [myWallet, staffTotals, childPlayers, directPlayers, ownerTopups, recent] = await Promise.all([
      this.#wallet(actor.id),
      this.#staffTotals(belowMe),
      this.#playerTotals({ parent_staff_id: { [Op.in]: staffIds } }),
      actor.canIssueFunds ? this.#playerTotals({ parent_staff_id: null, is_demo: false }) : null,
      actor.canIssueFunds ? this.#ownerTopupTotal(actor.id) : null,
      this.#recentTransfers(staffIds),
    ]);

    return {
      isOwner: Boolean(actor.canIssueFunds),
      myWallet,
      staff: staffTotals,
      players: { child: childPlayers, direct: directPlayers },
      ownerTopups,
      recent,
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Owner wallet
  // ══════════════════════════════════════════════════════════════════════

  /** Owner ka wallet — Add Balance popup ka "Current Balance". */
  async ownerWallet({ actor }) {
    if (!actor.canIssueFunds) throw onlyOwner();
    return {
      wallet: await this.#wallet(actor.id),
      directBalance: show(await readOwnerDirectBalance(this.models, actor.id)),
    };
  }

  /**
   * Owner ke Direct User wallet ka ledger — kab kya add hua, kis direct user ko diya / liya,
   * har entry ke pehle aur baad ka balance. Sirf owner.
   */
  async ownerDirectLedger({ actor, limit, offset, from, to }) {
    if (!actor.canIssueFunds) throw onlyOwner();
    return listOwnerDirectLedger(this.models, actor.id, { limit, offset, from, to });
  }

  /**
   * Owner apne Direct User balance (`staff_balances`) me paisa daalta hai.
   * Direct users ko dena / lena isi balance se hota hai. Rules wahi: sirf owner, password zaroori.
   */
  async ownerAddDirectBalance({ actor, amount, currency = 'INR', note, transactionPassword }) {
    if (!actor.canIssueFunds) throw onlyOwner();
    if (this.config?.WHITELABEL_MODE) throw companyNoSelfFunding();

    await assertTransactionPassword(this.models, actor.id, transactionPassword, { required: true });

    // Owner apni default coin (e.g. USDT) me daalta hai; wallet INR me hai, to abhi ke rate se INR me save.
    const code = String(currency).toUpperCase();
    const result = await this.db.transaction(async (transaction) => {
      if (code === 'INR') return addOwnerDirectBalance(this.models, { ownerId: actor.id, amount, note }, { transaction });
      const amountMinor = money.toMinor(amount);
      const wallet = new DirectWalletService({ models: this.models, db: this.db });
      const { inrMinor, rateMinor } = await wallet.inrValue(code, amountMinor, { transaction });
      const conversion = { currency: code, currencyAmount: money.toDecimalString(amountMinor), rate: money.toDecimalString(rateMinor) };
      return addOwnerDirectBalance(this.models, { ownerId: actor.id, amount: money.toDecimalString(inrMinor), note, conversion }, { transaction });
    });

    this.logger?.warn({ actorStaffId: actor.id, amount: result.amount }, 'Owner added Direct User balance');
    return result;
  }

  /**
   * Owner apne wallet me balance add karta hai.
   * Sirf owner, sirf apne wallet me, aur transaction password zaroori hai.
   */
  async ownerAddBalance({ actor, amount, note, transactionPassword }) {
    if (!actor.canIssueFunds) throw onlyOwner();
    if (this.config?.WHITELABEL_MODE) throw companyNoSelfFunding();

    await assertTransactionPassword(this.models, actor.id, transactionPassword, { required: true });

    const result = await this.db.transaction((transaction) =>
      addOwnerBalance(this.models, { ownerId: actor.id, amount, note }, { transaction })
    );

    this.logger?.warn({ actorStaffId: actor.id, amount: result.amount }, 'Owner added balance to own wallet');
    return result;
  }

  /**
   * Whitelabel company apne Direct User balance se Agent System balance me paisa le jaata hai
   * (parent site ka transfer Direct me aata hai; agents ko dena Agent System se hota hai).
   * Ek hi taraf, ek hi transaction me: Direct se kata tabhi Agent System me juda.
   */
  async ownerMoveToAgentSystem({ actor, amount, note, transactionPassword }) {
    if (!actor.canIssueFunds) throw onlyOwner();
    if (!this.config?.WHITELABEL_MODE) throw onlyWhitelabel();

    await assertTransactionPassword(this.models, actor.id, transactionPassword, { required: true });

    const result = await this.db.transaction((transaction) =>
      moveOwnerDirectToAgentSystem(this.models, { ownerId: actor.id, amount, note }, { transaction })
    );

    this.logger?.warn({ actorStaffId: actor.id, amount: result.amount }, 'Company moved Direct balance to Agent System');
    return result;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Account list + points settlement (zip: Account List, Active Users, Bank)
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Direct children ki list (zip `users/all-details`).
   * `parentId` do to us staff ke children — wo staff login wale ke tree me hona chahiye.
   */
  async accounts({ actor, parentId, search, channel, accountType, limit, offset }) {
    let listOf = Number(actor.id);
    if (parentId && Number(parentId) !== listOf) {
      const staffIds = await this.#treeStaffIds(actor);
      if (!staffIds.includes(Number(parentId))) throw notInTree();
      listOf = Number(parentId);
    }

    // Direct users (koi parent nahi) owner ke apne children hain.
    const withDirectUsers = Boolean(actor.canIssueFunds) && listOf === Number(actor.id);
    const result = await listChildren(this.sequelize, { parentId: listOf, withDirectUsers, search, channel, accountType, limit, offset });

    // `me` — D/W modal ki pehli line (parent ka naam aur balance).
    const staff = await this.models.Staff.findByPk(actor.id, { attributes: ['name'], raw: true });
    // Owner ke liye Direct User balance bhi — direct user ke D/W me wahi badalta hai.
    const directBalance = actor.canIssueFunds ? show(await readOwnerDirectBalance(this.models, actor.id)) : null;
    return { ...result, me: { ...(await this.#wallet(actor.id)), directBalance, username: staff?.name ?? String(actor.id) } };
  }

  /**
   * Points settlement (zip `POST /admin/wallet/points/settle`).
   * + points = parent deta hai (D), − points = parent leta hai (W).
   */
  async settle({ actor, accountType, accountId, points, remark, transactionPassword }) {
    // The route takes any wallet grant; D (+) needs wallet:credit, W (−) wallet:debit,
    // unless the caller holds the operator's wallet:adjust.
    const needed = Number(points) > 0 ? PERMISSIONS.WALLET_CREDIT : PERMISSIONS.WALLET_DEBIT;
    if (!hasPermission(actor.permissions, PERMISSIONS.WALLET_ADJUST) && !hasPermission(actor.permissions, needed)) {
      throw new AppError(`Missing required permission: ${needed}`, 403, 'FORBIDDEN');
    }

    // Hamesha zaroori — owner ke liye bhi, baaki money routes (add-balance, direct-wallet adjust) jaisa.
    await assertTransactionPassword(this.models, actor.id, transactionPassword, {
      required: true,
      executiveId: actor.executiveId ?? null,
    });

    const result = await this.db.transaction((transaction) =>
      settlePoints(this.models, { actor, accountType, accountId, points, remark }, { transaction })
    );

    this.logger?.info({ actorStaffId: actor.id, accountType, accountId, points: result.points }, 'Points settled');
    return result;
  }

  /**
   * Credit History — zip ka `POST /admin/ledger/user/history` (Credit Activity aur More modal).
   * Us wallet ki 'Bank Deposite' entries; remark ka "#sender/receiver" hissa batata hai kisne diya.
   */
  async creditHistory({ actor, accountType, accountId, limit, offset }) {
    const ids = accountType === 'staff' ? { staffId: accountId } : { userId: accountId };
    const walletId = await this.#walletIdInTree(actor, ids);
    if (!walletId) return { rows: [], total: 0 };

    const replacements = { walletId, eventType: 'Bank Deposite', limit, offset };
    const where = 'FROM mssports.point_ledger WHERE wallet_id = :walletId AND event_type = :eventType';
    const [rows, [{ total }]] = await Promise.all([
      this.sequelize.query(`SELECT id, username, delta, closing_inr_balance, remark, created_at ${where} ORDER BY created_at DESC, id DESC LIMIT :limit OFFSET :offset`, {
        replacements,
        type: QueryTypes.SELECT,
      }),
      this.sequelize.query(`SELECT COUNT(*)::int AS total ${where}`, { replacements, type: QueryTypes.SELECT }),
    ]);

    return {
      rows: rows.map((r) => {
        // remark: "...#from/to" — # ke baad sender/receiver
        const from = r.remark && r.remark.includes('#') ? r.remark.split('#').pop().split('/')[0] : null;
        return {
          id: String(r.id),
          superUser: from, // jisne diya
          user: r.username, // jisko mila
          transferFrom: from,
          amount: show(r.delta),
          balance: r.closing_inr_balance == null ? null : show(r.closing_inr_balance),
          createdAt: r.created_at,
        };
      }),
      total,
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Point ledger
  // ══════════════════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════════════════════
  //  Helpers
  // ══════════════════════════════════════════════════════════════════════

  /** Login wale ke neeche ke saare staff ids (khud bhi). Owner = poori site. */
  async #treeStaffIds(actor) {
    const ids = await manageableStaffIds(this.models, actor.id, { logger: this.logger, level: actor.level });
    return ids.map(Number);
  }

  /** Ek staff/owner ka wallet. Row na ho to sab 0. */
  async #wallet(staffId) {
    const row = await this.models.StaffCredits.findOne({ where: { staff_id: staffId }, raw: true });
    return {
      staffId: Number(staffId),
      userType: row?.user_type ?? 'STAFF',
      balance: show(row?.inr),
      creditLimit: show(row?.credit_limit),
      credit: show(row?.credit),
      allPoint: show(row?.all_point),
    };
  }

  async #staffTotals(staffIds) {
    if (!staffIds.length) return { count: 0, balance: show(0) };
    const [row] = await this.sequelize.query(
      'SELECT COUNT(*)::int AS count, COALESCE(SUM(inr), 0) AS balance FROM credits WHERE staff_id IN (:staffIds)',
      { replacements: { staffIds }, type: QueryTypes.SELECT }
    );
    return { count: row.count, balance: show(row.balance) };
  }

  /** Players ki ginti aur unka total balance (`credits.inr`). */
  async #playerTotals(userWhere) {
    if (Array.isArray(userWhere.parent_staff_id?.[Op.in]) && !userWhere.parent_staff_id[Op.in].length) {
      return { count: 0, balance: show(0) };
    }
    const players = await this.models.Users.findAll({ where: userWhere, attributes: ['id'], raw: true });
    if (!players.length) return { count: 0, balance: show(0) };

    const [row] = await this.sequelize.query(
      'SELECT COALESCE(SUM(inr), 0) AS balance FROM credits WHERE uid IN (:ids)',
      { replacements: { ids: players.map((p) => p.id) }, type: QueryTypes.SELECT }
    );
    return { count: players.length, balance: show(row.balance) };
  }

  async #ownerTopupTotal(ownerId) {
    const total = await this.models.StaffTransfers.sum('amount', {
      where: { to_type: 'staff', to_id: ownerId, transfer_type: TRANSFER_TYPE.OWNER_TOPUP },
    });
    return { total: show(total ?? 0) };
  }

  /** Last 10 len-den jisme tree ka koi staff shaamil ho. */
  async #recentTransfers(staffIds) {
    if (!staffIds.length) return [];
    const rows = await this.models.StaffTransfers.findAll({
      where: {
        [Op.or]: [
          { from_type: 'staff', from_id: { [Op.in]: staffIds } },
          { to_type: 'staff', to_id: { [Op.in]: staffIds } },
        ],
      },
      order: [['created_at', 'DESC'], ['id', 'DESC']],
      limit: 10,
      raw: true,
    });
    return rows.map((r) => ({
      id: String(r.id),
      from: { type: r.from_type, id: String(r.from_id) },
      to: { type: r.to_type, id: String(r.to_id) },
      amount: show(r.amount),
      direction: r.direction ?? null,
      transferType: r.transfer_type ?? null,
      note: r.note ?? null,
      createdAt: r.created_at,
    }));
  }

  /** Wallet id (credits.id) — sirf agar account login wale ke tree me hai. */
  async #walletIdInTree(actor, { staffId, userId }) {
    const staffIds = await this.#treeStaffIds(actor);

    if (userId) {
      const user = await this.models.Users.findByPk(userId, { attributes: ['id', 'parent_staff_id', 'is_demo'], raw: true });
      const visible = user && (staffIds.includes(Number(user.parent_staff_id))
        || (user.parent_staff_id == null && !user.is_demo && actor.canIssueFunds));
      if (!visible) throw notInTree();
      const wallet = await this.models.Credits.findOne({ where: { uid: userId }, attributes: ['id'], raw: true });
      return wallet?.id ?? null;
    }

    const target = Number(staffId ?? actor.id);
    if (!staffIds.includes(target)) throw notInTree();
    const wallet = await this.models.StaffCredits.findOne({ where: { staff_id: target }, attributes: ['id'], raw: true });
    return wallet?.id ?? null;
  }
}

module.exports = { ExchangeService };
