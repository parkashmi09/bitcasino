'use strict';

const { Op } = require('sequelize');
const { AppError, money } = require('@ibitplay/common');

const { StaffService } = require('../staff/staff.service');
const { PlayersService } = require('../players/players.service');
const { readStaffFloat } = require('../lords/staffFloat');
const { assertTransactionPassword } = require('../staff-auth/transactionPassword');

/**
 * Create Account — zip ka `users/InsertUser.jsx` + `userController.createUserUnderParent`
 * / `StaffController.createStaff`.
 *
 * Naya account login wale ke NEECHE banta hai. Money ka koi naya raasta nahi:
 *   userType: 'USER' = player, warna staff ka level (2 Admin … 6 Agent)
 *   staff  → StaffService.create, phir Credit Amount ho to StaffService.transfer (deposit)
 *   player → PlayersService.create (opening balance usi me — point ledger bhi wahi likhta hai)
 * Dono ka credits row wahi services banati hain.
 *
 * Zip jaisa: parent ke paas Credit Amount jitna balance nahi → account phir bhi banta hai,
 * 0 credit ke saath, aur message me parent ka balance (`creditSkipped`).
 */

const MESSAGES = Object.freeze({
  USERNAME_EXISTS: 'User Name Already Exists',
  INSERTED: 'User created successfully under parent',
  CREDIT_AMOUNT_INVALID: 'creditamount is invalid.',
  SELECT_PROPER_USER_TYPE: 'Select Proper User type',
  createdInsufficientCredit: (bal) =>
    `User Sucessfully Inserted But Your Client Does Not Have Sufficient Credit, Because Client Credit is : ${Number(bal).toFixed(2)}`,
});

const badRequest = (message, code = 'EXCHANGE_ACCOUNTS_BAD_REQUEST') => new AppError(message, 400, code);

/** Naam users, staff aur executives — teeno me kahin bhi ho to "taken" (case-insensitive). */
async function isUsernameTaken(models, username) {
  const name = String(username).trim();
  const [user, staff, executive] = await Promise.all([
    models.Users.findOne({ where: { name: { [Op.iLike]: name } }, attributes: ['id'], raw: true }),
    models.Staff.findOne({ where: { name: { [Op.iLike]: name } }, attributes: ['id'], raw: true }),
    models.Executives.findOne({ where: { username: { [Op.iLike]: name } }, attributes: ['id'], raw: true }),
  ]);
  return Boolean(user || staff || executive);
}

/** Zip: khali = 0, warna plain number, max 2 decimal. Galat → 'creditamount is invalid.' */
function parseCreditAmount(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') return '0';
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw badRequest(MESSAGES.CREDIT_AMOUNT_INVALID, 'EXCHANGE_ACCOUNTS_CREDIT_INVALID');
  return money.toDecimalString(money.toMinor(text));
}

/** User Rate → staff.percentage (0.001 se 100 tak). Khali = kuch nahi. */
function parsePercentage(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') return undefined;
  const value = Number(text);
  if (!/^\d*\.?\d+$/.test(text) || value < 0.001) throw badRequest('The User Rate field must be 0.001 or more');
  if (value > 100) throw badRequest('The User Rate field must be 100 or less');
  return String(Math.round(value * 1000) / 1000);
}

/**
 * User Type (staff level 2 Admin … 6 Agent) → us level ka role id (roles table, sabse pehla).
 * Executive (7) yahan se nahi banta — wo Multi Login se.
 */
async function staffRoleIdFor(models, level) {
  const wanted = Number(level);
  if (!(wanted >= 2 && wanted <= 6)) throw badRequest(MESSAGES.SELECT_PROPER_USER_TYPE, 'EXCHANGE_ACCOUNTS_USER_TYPE');
  const role = await models.Roles.findOne({ where: { level: wanted }, order: [['id', 'ASC']], attributes: ['id'], raw: true });
  if (!role) throw badRequest(MESSAGES.SELECT_PROPER_USER_TYPE, 'EXCHANGE_ACCOUNTS_USER_TYPE');
  return role.id;
}

class CreateAccountService {
  constructor(deps) {
    this.models = deps.models;
    this.logger = deps.logger;
    this.db = deps.db;
    this.staffService = new StaffService(deps);
    this.playersService = new PlayersService(deps);
  }

  /** Zip ka GET users/check-username: 200 = available, 202 = taken. */
  async checkUsername(username) {
    const taken = await isUsernameTaken(this.models, username);
    return { available: !taken, message: taken ? MESSAGES.USERNAME_EXISTS : 'User Name is available' };
  }

  /**
   * @param {object} p
   * @param {object} p.staffActor   StaffService wala actor (actorFrom)
   * @param {object} p.playerActor  PlayersService wala actor (req.staff)
   */
  async create({ staffActor, playerActor, username, email, password, phone, creditAmount, userType, percentage, transactionPassword }) {
    // 1. Naam pehle — zip bhi sabse pehle duplicate check karta hai.
    if (await isUsernameTaken(this.models, username)) {
      throw new AppError(MESSAGES.USERNAME_EXISTS, 409, 'EXCHANGE_ACCOUNTS_USERNAME_EXISTS');
    }

    const credit = parseCreditAmount(creditAmount);
    const isPlayer = userType === 'USER';
    const rate = isPlayer ? undefined : parsePercentage(percentage);
    const roleId = isPlayer ? null : await staffRoleIdFor(this.models, userType);
    // Hamare platform pe staff password kam se kam 12 ka (staff module ka rule).
    if (!isPlayer && String(password).length < 12) throw badRequest('The Password field must be at least 12 characters');
    // Staff ki email form se aati hai (pehle username se banti thi). Zaroori aur unique.
    if (!isPlayer) {
      if (!email) throw badRequest('The Email field is required', 'EXCHANGE_ACCOUNTS_EMAIL_REQUIRED');
      const { sequelize } = this.models.Staff;
      const taken = await this.models.Staff.findOne({
        where: sequelize.where(sequelize.fn('LOWER', sequelize.col('email')), email),
        attributes: ['id'],
        raw: true,
      });
      if (taken) throw new AppError('This email is already in use', 409, 'EXCHANGE_ACCOUNTS_EMAIL_EXISTS');
    }

    // 2. Transaction Code — form pe hamesha hai, aur sabke liye zaroori (owner bhi; user, 2026-10-20).
    await assertTransactionPassword(this.models, staffActor.id, transactionPassword, {
      required: true,
      executiveId: staffActor.executiveId ?? null,
    });

    // 3. Parent ke paas Credit Amount jitna balance hai? Nahi to 0 credit pe banao (zip).
    const wantsCredit = money.toMinor(credit) > 0n;
    const float = wantsCredit ? await readStaffFloat(this.models, staffActor.id) : null;
    // TENEXCH: settlement points (upper_point + down_point) opening credit me nahi ja sakte.
    const spendable = wantsCredit ? await this.#spendable(staffActor.id, float.balance) : null;
    const parentShort = wantsCredit && money.toMinor(spendable) < money.toMinor(credit);
    const opening = wantsCredit && !parentShort ? credit : '0';

    const account = isPlayer
      ? await this.#createPlayer({ playerActor, username, password, phone, opening, transactionPassword })
      : await this.#createStaff({ staffActor, username, email, password, phone, roleId, percentage: rate, opening, transactionPassword });

    this.logger?.info({ actorStaffId: staffActor.id, accountType: account.accountType, accountId: account.id, opening }, 'Exchange account created');

    return {
      success: true,
      creditSkipped: parentShort,
      message: parentShort ? MESSAGES.createdInsufficientCredit(spendable) : MESSAGES.INSERTED,
      data: account,
    };
  }

  /** Float − settlement points (`upper_point + down_point`, sirf positive ho to). */
  async #spendable(staffId, balance) {
    const [row] = await this.models.StaffCredits.sequelize.query('SELECT upper_point, down_point FROM credits WHERE staff_id = :staffId', {
      replacements: { staffId },
      type: 'SELECT',
    });
    const extra = money.toMinorQuantised(row?.upper_point ?? '0') + money.toMinorQuantised(row?.down_point ?? '0');
    return extra > 0n ? money.toDecimalString(money.toMinor(balance) - extra) : balance;
  }

  async #createPlayer({ playerActor, username, password, phone, opening, transactionPassword }) {
    const user = await this.playersService.create({
      actor: playerActor,
      username,
      phone: phone || undefined,
      password,
      initialBalance: opening,
      transactionPassword,
    });
    return { accountType: 'user', id: String(user.id), username: user.name, credit: opening };
  }

  /**
   * Staff + uska opening credit EK transaction me (TENEXCH createStaff jaisa): transfer fail ho
   * (jaise parent ke paas grant / balance nahi) to account bhi nahi banta. Opening ki point entry
   * 'User creation' / open:<walletId>.
   */
  async #createStaff({ staffActor, username, email, password, phone, roleId, percentage, opening, transactionPassword }) {
    return this.db.transaction(async (transaction) => {
    // Email Create Account form se (zaroori, `create` me check ho chuki).
    const staff = await this.staffService.create({
      actor: staffActor,
      name: username,
      email,
      password,
      phone: phone || undefined,
      roleId,
      percentage,
    }, { transaction });

    if (money.toMinor(opening) > 0n) {
      await this.staffService.transfer(
        {
          actor: staffActor,
          toType: 'staff',
          toId: staff.id,
          amount: opening,
          direction: 'deposit',
          transactionPassword,
          opening: true,
        },
        { transaction }
      );
    }
    return { accountType: 'staff', id: String(staff.id), username: staff.name ?? username, credit: opening };
    });
  }
}

module.exports = { CreateAccountService, isUsernameTaken, MESSAGES };
