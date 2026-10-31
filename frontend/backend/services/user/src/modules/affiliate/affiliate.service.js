'use strict';

const { Op, fn, col } = require('sequelize');
const { money } = require('@ibitplay/common');

const errors = require('./affiliate.errors');
const { UNLOCK_TIERS, REWARD_CURRENCY } = require('./affiliate.constants');
const { WalletService } = require('../wallet/wallet.service');
const { REASON } = require('../wallet/wallet.constants');

/**
 * The referral programme: teams, rewards, and unlocking them.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ANYONE COULD MINT A REWARD
 *
 *   POST /affiliate/process-wager
 *   { uid, membername, wagerAmount: 9217000 }
 *
 * Unauthenticated, and the reward tier was chosen from `wagerAmount` — a number
 * in the request body. The only check was that it exceeded the member's
 * recorded wager, which an inflated figure passes by construction. Post the top
 * tier, get a $500 unlocked reward, then claim it into your balance.
 *
 * The unlock below reads the member's wager from `userwager`. There is no
 * parameter for it, so the tier cannot be chosen by the caller.
 *
 * ── AND CLAIMING PAID TWICE ──────────────────────────────────────────────
 *
 *     SELECT * FROM unlocked_rewards WHERE id = $1 AND uid = $2 AND claimed = false
 *     UPDATE unlocked_rewards SET claimed = true WHERE id = $1     ← unconditional
 *     UPDATE credits SET bjb = bjb + $2
 *
 * The third occurrence of this exact shape on the platform. Worse here, because
 * `claim-reward` and `claim-reward-all` are separate endpoints hitting the same
 * rows — running one of each concurrently paid the same reward twice without
 * needing a race between two identical requests.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Teams are joined on `users.name` text rather than an id, which is how legacy
 * modelled them. That is preserved (the columns are text) but every write here
 * resolves the name to a real user first, so a team row cannot name someone who
 * does not exist.
 */
class AffiliateService {
  constructor(deps) {
    const { models, db, logger, config } = deps;
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.config = config;
    this.wallet = new WalletService(deps);
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Players
  // ══════════════════════════════════════════════════════════════════════

  /** @legacy GET /affiliate/referral-info/:userId */
  async referralInfo({ userId }) {
    const user = await this.models.Users.findByPk(userId, {
      attributes: ['id', 'name', 'referalcode', 'referral_link'],
      raw: true,
    });
    if (!user) throw errors.USER_NOT_FOUND({ userId });
    if (!user.referalcode) throw errors.NO_REFERRAL_CODE({ userId });

    return {
      referralCode: user.referalcode,
      // Built from the configured public origin. Legacy hard-coded
      // `https://addaplay.com/referal/...` in the controller, so the link was
      // wrong on every environment that was not that one.
      referralLink: `${String(this.config.PUBLIC_SITE_URL || '').replace(/\/+$/, '')}/referal/${user.referalcode}`,
    };
  }

  /**
   * @legacy GET /affiliate/team/:referralCode
   *
   * A player's own team. Scoped to the caller's code — legacy took the code
   * from the URL and returned whoever's team it named, so any referral code
   * (which is shared publicly, by design) exposed that player's whole downline
   * with email addresses attached.
   */
  async myTeam({ userId, limit = 100, offset = 0 }) {
    const user = await this.#user(userId);
    if (!user.referalcode) return { referralCode: null, total: 0, members: [] };

    const { rows, count } = await this.models.Team.findAndCountAll({
      where: { referalCode: user.referalcode },
      order: [['createdAt', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    const members = await this.#usersByName(rows.map((r) => r.membername));

    return {
      referralCode: user.referalcode,
      total: count,
      members: rows.map((r) => {
        const member = members.get(r.membername);
        return {
          name: r.membername,
          joinedAt: r.createdAt,
          // Deliberately NOT the email address. Legacy's team query selected
          // `u.email` and returned it to whoever asked — a referral code is a
          // public thing, so that published the email of everyone who used it.
          level: member?.level ?? null,
          avatar: member?.avatar ?? null,
        };
      }),
    };
  }

  /**
   * @legacy GET /affiliate/rewards/:referralCode
   * @legacy GET /api/rewards/:uid
   *
   * What this player has earned from the people they referred.
   *
   * ─────────────────────────────────────────────────────────────────────
   * LEGACY MATCHED ON A DISPLAY NAME
   *
   * `/api/rewards/:uid` read the player's `name` and then selected
   * `WHERE ownername = $1`. `users.name` is not unique, so two players who
   * chose the same name each saw the other's referral earnings — and, on the
   * companion members endpoint, the other's downline. It is also mutable: a
   * name change orphaned every reward row already written under the old one.
   *
   * `referalCode` is the stable key and is what this matches on. Rows written
   * before a rename keep pointing at the same player.
   *
   * THE TOTAL WAS OFF BY A PAGE. My own first version of this summed
   * `rows` — the current page — and returned it beside `total: count`, the
   * count of ALL matching rows. Page 1 of 5 reported a fifth of the earnings
   * under a label that says otherwise. The sum is an aggregate over the whole
   * set now, computed by the database.
   * ─────────────────────────────────────────────────────────────────────
   *
   * @param filter `today` restricts to rows created today; anything else is all
   *   of them. Legacy spelled this `?filter=today` and it is kept.
   */
  async myRewards({ userId, filter, limit = 100, offset = 0 }) {
    const user = await this.#user(userId);
    if (!user.referalcode) return { total: 0, totalAmount: '0', rows: [] };

    const where = {
      referalCode: user.referalcode,
      ...(filter === 'today'
        ? { createdAt: { [Op.gte]: this.#startOfToday() } }
        : {}),
    };

    const [{ rows, count }, [totals]] = await Promise.all([
      this.models.Rewards.findAndCountAll({
        where,
        order: [['createdAt', 'DESC']],
        limit,
        offset,
        raw: true,
      }),
      // Summed by Postgres over every matching row, not by JavaScript over the
      // page. Legacy's other total used `reduce((sum, r) => sum + r.amount)` on
      // values Postgres returns as STRINGS for DECIMAL columns, so it was
      // string concatenation: "0" + "5.00" + "12.00" → "05.0012.00".
      this.models.Rewards.findAll({
        attributes: [[fn('COALESCE', fn('SUM', col('amount')), 0), 'total']],
        where,
        raw: true,
      }),
    ]);

    const totalAmount = money.toDecimalString(money.toMinor(totals?.total ?? '0'));

    return {
      total: count,
      totalAmount,
      rows: rows.map((r) => ({
        owner: r.ownername,
        member: r.membername,
        amount: money.toDecimalString(money.toMinor(r.amount ?? '0')),
        coin: r.coin,
        type: r.type,
        referredAmount: money.toDecimalString(money.toMinor(r.referalmount ?? '0')),
        createdAt: r.createdAt,
      })),
    };
  }

  /** @legacy GET /affiliate/unclaimed-rewards/:uid */
  async unclaimedRewards({ userId }) {
    const rows = await this.models.UnlockedRewards.findAll({
      where: { uid: userId, claimed: false },
      order: [['id', 'DESC']],
      raw: true,
    });

    const total = rows.reduce((sum, r) => money.toDecimalString(money.add(sum, r.amount ?? '0')), '0');

    return {
      total,
      currency: REWARD_CURRENCY,
      rows: rows.map((r) => this.#shapeUnlocked(r)),
    };
  }

  /**
   * @legacy POST /affiliate/claim-reward
   *
   * Claim one unlocked reward.
   */
  async claimReward({ userId, rewardId }) {
    const reward = await this.models.UnlockedRewards.findOne({
      where: { id: rewardId, uid: userId },
      raw: true,
    });

    // Scoped to the caller AND reported as not-found either way, so a probe
    // cannot distinguish "someone else's" from "does not exist".
    if (!reward) throw errors.NOT_YOUR_REWARD({ rewardId });
    if (reward.claimed) throw errors.ALREADY_CLAIMED({ rewardId });

    const amount = money.toDecimalString(money.toMinor(reward.amount ?? '0'));

    return this.db.transaction(async (transaction) => {
      const paid = await this.#payReward({ userId, reward, amount, transaction });
      if (!paid) throw errors.ALREADY_CLAIMED({ rewardId });

      this.logger?.info({ userId, rewardId, amount }, 'Affiliate reward claimed');
      return { rewardId, amount, currency: REWARD_CURRENCY, newBalance: paid.newBalance };
    });
  }

  /**
   * @legacy POST /affiliate/claim-reward-all
   *
   * Claim everything outstanding.
   *
   * Each reward is claimed by the same conditional update as the single-reward
   * path, so running both concurrently pays each reward exactly once — which
   * legacy did not, because neither guarded its update.
   */
  async claimAllRewards({ userId }) {
    const rewards = await this.models.UnlockedRewards.findAll({
      where: { uid: userId, claimed: false },
      raw: true,
    });

    if (!rewards.length) throw errors.NOTHING_TO_CLAIM({ userId });

    return this.db.transaction(async (transaction) => {
      const claimed = [];
      let total = '0';

      for (const reward of rewards) {
        const amount = money.toDecimalString(money.toMinor(reward.amount ?? '0'));
        const paid = await this.#payReward({ userId, reward, amount, transaction });

        // Someone else claimed this one between the read and now. Skip it
        // rather than failing the whole batch — the other rewards are still
        // legitimately owed.
        if (!paid) continue;

        claimed.push({ ...this.#shapeUnlocked(reward), amount });
        total = money.toDecimalString(money.add(total, amount));
      }

      if (!claimed.length) throw errors.NOTHING_TO_CLAIM({ userId });

      this.logger?.info({ userId, count: claimed.length, total }, 'All affiliate rewards claimed');
      return { total, currency: REWARD_CURRENCY, count: claimed.length, rewards: claimed };
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Team membership
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy POST /affiliate/team/add
   *
   * Join a team by referral code.
   *
   * Legacy took `ownername`, `username` AND `referralCode` from the body and
   * inserted all three verbatim — no check that any of them existed, that the
   * code belonged to the owner, or that the member was not already on a team.
   * A team row could name anyone, including people who had never signed up.
   */
  async joinTeam({ userId, referralCode }) {
    const member = await this.#user(userId);

    const owner = await this.models.Users.findOne({
      where: { referalcode: referralCode },
      attributes: ['id', 'name', 'referalcode'],
      raw: true,
    });
    if (!owner) throw errors.INVALID_REFERRAL_CODE({ referralCode });
    if (Number(owner.id) === Number(userId)) throw errors.CANNOT_REFER_SELF();

    const [row, created] = await this.models.Team.findOrCreate({
      where: { membername: member.name },
      defaults: {
        ownername: owner.name,
        membername: member.name,
        referalCode: owner.referalcode,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // A player belongs to one team. Legacy allowed a member row per call, so
    // repeated posts stacked the same player under several owners — and every
    // one of them earned commission on that player's wagering.
    if (!created) throw errors.ALREADY_ON_TEAM({ owner: row.get('ownername') });

    this.logger?.info({ userId, owner: owner.name, referralCode }, 'Joined affiliate team');
    return { owner: owner.name, referralCode: owner.referalcode, joinedAt: row.get('createdAt') };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Unlocking
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy POST /affiliate/process-wager
   *
   * Unlock whatever tier a team member's wagering has now earned their referrer.
   *
   * The wager is read from `userwager` — our record — and NOT from the caller.
   * See the module header for what the old parameter allowed.
   *
   * Called by staff or by a scheduled job, never by a player: the person who
   * benefits from an unlock must not be the one who triggers it.
   */
  async unlockFor({ memberName, staffId = null }) {
    const member = await this.models.Users.findOne({
      where: { name: memberName },
      attributes: ['id', 'name'],
      raw: true,
    });
    if (!member) throw errors.MEMBER_NOT_FOUND({ memberName });

    const team = await this.models.Team.findOne({ where: { membername: memberName }, raw: true });
    if (!team) throw errors.MEMBER_NOT_FOUND({ memberName });

    const owner = await this.models.Users.findOne({
      where: { name: team.ownername },
      attributes: ['id', 'name', 'referalcode'],
      raw: true,
    });
    if (!owner) throw errors.USER_NOT_FOUND({ name: team.ownername });

    const wagerRow = await this.models.Userwager.findOne({ where: { uid: member.id }, raw: true });
    const wager = this.#wagerAmount(wagerRow);

    const tier = this.#tierFor(wager);
    if (!tier) return { unlocked: false, reason: 'The member has not reached the first tier', wager };

    return this.db.transaction(async (transaction) => {
      /**
       * Only unlock a tier ABOVE the highest already granted for this member.
       *
       * Without this, running the job twice grants the same tier twice —
       * and legacy's check (`wager_amount >= $2`) compared against the
       * caller-supplied figure rather than the tier, so a caller could step it
       * by one and unlock repeatedly.
       */
      const highest = await this.models.UnlockedRewards.findOne({
        where: { membername: memberName },
        order: [['wager_amount', 'DESC']],
        lock: transaction.LOCK.UPDATE,
        transaction,
        raw: true,
      });

      if (highest && money.gte(String(highest.wager_amount ?? '0'), tier.wager)) {
        return { unlocked: false, reason: 'This tier has already been unlocked', tier: tier.wager, wager };
      }

      const created = await this.models.UnlockedRewards.create(
        {
          uid: owner.id,
          ownername: owner.name,
          membername: memberName,
          amount: tier.reward,
          cointype: REWARD_CURRENCY,
          // NOT NULL on this table. Taken from the TEAM row, not the owner's
          // current code: a referrer who regenerates their code must not
          // orphan the rewards already earned under the old one.
          referalCode: team.referalCode ?? owner.referalcode,
          // OUR figure, so a later run compares against something real.
          wager_amount: tier.wager,
          claimed: false,
        },
        { transaction }
      );

      this.logger?.info(
        { owner: owner.name, member: memberName, tier: tier.wager, reward: tier.reward, staffId },
        'Affiliate reward unlocked'
      );

      return {
        unlocked: true,
        rewardId: created.id,
        owner: owner.name,
        member: memberName,
        tier: tier.wager,
        amount: tier.reward,
        wager,
      };
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Staff
  // ══════════════════════════════════════════════════════════════════════

  /** @legacy GET /affiliateAdmin/teams */
  async listTeams({ search, limit = 50, offset = 0 }) {
    const rows = await this.models.Team.findAll({
      attributes: ['ownername', [fn('COUNT', col('membername')), 'members']],
      where: search ? { ownername: { [Op.iLike]: `%${search}%` } } : {},
      group: ['ownername'],
      order: [[fn('COUNT', col('membername')), 'DESC']],
      limit,
      offset,
      raw: true,
    });

    return {
      total: rows.length,
      rows: rows.map((r) => ({ owner: r.ownername, members: Number(r.members) })),
    };
  }

  /** @legacy GET /affiliateAdmin/teams/:teamId/members */
  async teamMembers({ owner, limit = 100, offset = 0 }) {
    const { rows, count } = await this.models.Team.findAndCountAll({
      where: { ownername: owner },
      order: [['createdAt', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    return {
      total: count,
      rows: rows.map((r) => ({ member: r.membername, referralCode: r.referalCode, joinedAt: r.createdAt })),
    };
  }

  /** @legacy GET /affiliateAdmin/users-with-teams */
  async usersWithTeams({ limit = 100, offset = 0 }) {
    const { rows, count } = await this.models.Team.findAndCountAll({
      order: [['createdAt', 'DESC']],
      limit,
      offset,
      raw: true,
    });
    return {
      total: count,
      rows: rows.map((r) => ({ owner: r.ownername, member: r.membername, joinedAt: r.createdAt })),
    };
  }

  /** @legacy GET /affiliateAdmin/dashboard-stats */
  async dashboardStats() {
    const [teams, members, unlocked, claimed] = await Promise.all([
      this.models.Team.count({ distinct: true, col: 'ownername' }),
      this.models.Team.count(),
      this.models.UnlockedRewards.findAll({
        attributes: [[fn('SUM', col('amount')), 'total'], [fn('COUNT', col('id')), 'count']],
        raw: true,
      }),
      this.models.UnlockedRewards.findAll({
        where: { claimed: true },
        attributes: [[fn('SUM', col('amount')), 'total'], [fn('COUNT', col('id')), 'count']],
        raw: true,
      }),
    ]);

    const unlockedTotal = money.toDecimalString(money.toMinor(unlocked[0]?.total ?? '0'));
    const claimedTotal = money.toDecimalString(money.toMinor(claimed[0]?.total ?? '0'));

    return {
      teams,
      members,
      unlockedCount: Number(unlocked[0]?.count ?? 0),
      unlockedTotal,
      claimedCount: Number(claimed[0]?.count ?? 0),
      claimedTotal,
      // What the platform still owes. Legacy's dashboard reported unlocked and
      // claimed separately and never the difference, which is the number that
      // matters on a balance sheet.
      outstanding: money.toDecimalString(money.subtract(unlockedTotal, claimedTotal)),
      currency: REWARD_CURRENCY,
    };
  }

  /** @legacy GET /affiliateAdmin/rewards-list */
  async listRewards({ claimed, owner, limit = 50, offset = 0 }) {
    const { rows, count } = await this.models.UnlockedRewards.findAndCountAll({
      where: {
        ...(claimed !== undefined ? { claimed } : {}),
        ...(owner ? { ownername: owner } : {}),
      },
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });
    return { total: count, rows: rows.map((r) => this.#shapeUnlocked(r)) };
  }

  /** @legacy GET /affiliateAdmin/top-affiliates */
  async topAffiliates({ limit = 20 }) {
    const rows = await this.models.UnlockedRewards.findAll({
      attributes: [
        'ownername',
        [fn('SUM', col('amount')), 'total'],
        [fn('COUNT', col('id')), 'rewards'],
      ],
      group: ['ownername'],
      order: [[fn('SUM', col('amount')), 'DESC']],
      limit,
      raw: true,
    });

    return rows.map((r) => ({
      owner: r.ownername,
      rewards: Number(r.rewards),
      total: money.toDecimalString(money.toMinor(r.total ?? '0')),
      currency: REWARD_CURRENCY,
    }));
  }

  /** @legacy POST /affiliate/rewards/record — staff only; this creates a payable. */
  async recordReward({ ownerName, memberName, referralCode, amount, coin }) {
    const row = await this.models.Rewards.create({
      ownername: ownerName,
      membername: memberName,
      referalCode: referralCode,
      amount,
      coin: coin ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return row.get({ plain: true });
  }

  // ══════════════════════════════════════════════════════════════════════

  /**
   * Mark one reward claimed and pay it, or report that someone else got there.
   *
   * The conditional update is the whole point: `claimed: false` in the WHERE
   * means the database picks a winner between the single-claim and claim-all
   * paths, which legacy's unconditional `WHERE id = $1` did not.
   */
  async #payReward({ userId, reward, amount, transaction }) {
    const [affected] = await this.models.UnlockedRewards.update(
      { claimed: true },
      { where: { id: reward.id, claimed: false }, transaction }
    );
    if (affected === 0) return null;

    return this.wallet.credit(
      {
        userId,
        currency: REWARD_CURRENCY,
        amount,
        reason: REASON.BONUS,
        idempotencyKey: `affiliate:${reward.id}`,
        refType: 'AFFILIATE_REWARD',
        refId: String(reward.id),
        description: `Affiliate reward for ${reward.membername}`,
      },
      { sourceService: 'user-service', transaction }
    );
  }

  /** The highest tier this wager has reached, or null. */
  #tierFor(wager) {
    for (let i = UNLOCK_TIERS.length - 1; i >= 0; i -= 1) {
      if (money.gte(wager, UNLOCK_TIERS[i].wager)) return UNLOCK_TIERS[i];
    }
    return null;
  }

  /**
   * Midnight, for the `?filter=today` variant.
   *
   * Legacy wrote `"createdAt"::date = CURRENT_DATE`, which casts every row's
   * timestamp before comparing — so the index on `createdAt` cannot be used and
   * the filter scans the table. A half-open range on the raw column can.
   *
   * Both interpret "today" in the database server's timezone. That is what
   * legacy did and changing it would move the boundary under existing reports;
   * it is called out here because a player in another timezone will disagree
   * with this endpoint about which day a reward landed on.
   */
  #startOfToday() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return start;
  }

  /** `userwager.wager` is TEXT with thousands separators. */
  #wagerAmount(row) {
    const raw = row?.wager;
    if (raw == null) return '0';
    const cleaned = String(raw).replace(/,/g, '').trim();
    return /^-?\d+(\.\d+)?$/.test(cleaned) ? cleaned : '0';
  }

  async #user(userId) {
    const user = await this.models.Users.findByPk(userId, {
      attributes: ['id', 'name', 'referalcode'],
      raw: true,
    });
    if (!user) throw errors.USER_NOT_FOUND({ userId });
    return user;
  }

  async #usersByName(names) {
    if (!names.length) return new Map();
    const rows = await this.models.Users.findAll({
      where: { name: [...new Set(names)] },
      attributes: ['id', 'name', 'level', 'avatar'],
      raw: true,
    });
    return new Map(rows.map((r) => [r.name, r]));
  }

  #shapeUnlocked(row) {
    return {
      id: row.id,
      owner: row.ownername,
      member: row.membername,
      amount: money.toDecimalString(money.toMinor(row.amount ?? '0')),
      currency: row.cointype ?? REWARD_CURRENCY,
      tier: row.wager_amount != null ? String(row.wager_amount) : null,
      claimed: Boolean(row.claimed),
    };
  }
}

module.exports = { AffiliateService };
