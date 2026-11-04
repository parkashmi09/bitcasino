'use strict';

/* The referrer lookup (which needs `where(fn(...), value)`) now lives in
   `referrerResolver.js`, shared with signup and the public code check. */
const { Op, fn, col, QueryTypes } = require('sequelize');
const { money, creditableCurrency, wagerCategory, defaultCurrencyOf } = require('@ibitplay/common');
const { promotionsBlocked, assertPlayerCapability } = require('@ibitplay/auth');

const errors = require('./affiliate.errors');
const { UNLOCK_TIERS, REWARD_CURRENCY } = require('./affiliate.constants');
const { affiliateSettings } = require('./affiliateSettings');
const { WalletService } = require('../wallet/wallet.service');
const { REASON } = require('../wallet/wallet.constants');
const { resolveReferrerOwner, referralLinkFor } = require('./referrerResolver');
const { createRewardMoney, USD_CODES } = require('../../lib/rewardMoney');
const { notifyPlayer, notifyBonus, afterBonus } = require('../notifications/notifyPlayer');
const { settleItem } = require('../wager/stakeShare');

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
    this.settings = affiliateSettings(deps);
    /** The site's ONE reward currency, and USD → reward conversion. */
    this.rewardMoney = deps.rewardMoney ?? createRewardMoney(deps);
  }

  /**
   * casino-service calls this after every stake that moves `userwager`.
   *
   * Unlocks the next affiliate tier for referred players and accrues commission
   * into `rewards` using `commissionPercent` from site config.
   *
   * `source` / `ref` name the stake (`wager_activity`) the delta came from; they are
   * stored on the commission row so a refund / rollback / void of that stake can find
   * it (`onReverse`, migration 090). Absent for callers that do not have one.
   */
  async onWager({ userId, previousWager, newWager, source = null, ref = null, kind = null }) {
    const member = await this.#user(userId);
    const team = await this.models.Team.findOne({ where: { membername: member.name }, raw: true });
    if (!team) return { onTeam: false };

    /* Affiliate sirf direct users ka: referrer YA member child user (koi parent) ho to
       kuch nahi — no tier unlock, no commission. */
    if ((await this.#ownerHasNoPromotions(team.ownername)) || (await promotionsBlocked(member.id))) {
      this.logger?.info({ owner: team.ownername, member: member.name }, 'Affiliate earnings skipped: agent-tree referrer');
      return { onTeam: true, unlock: { unlocked: false }, commissionRecorded: false, skipped: 'AGENT_TREE_PLAYER' };
    }

    let unlock = { unlocked: false };
    try {
      unlock = await this.unlockFor({ memberName: member.name });
    } catch (error) {
      this.logger?.warn(
        { err: error, userId, member: member.name },
        'Affiliate tier unlock on wager failed'
      );
    }

    const prev = this.#wagerAmount({ wager: previousWager });
    const next = this.#wagerAmount({ wager: newWager });
    const delta = money.subtract(next, prev);
    if (!money.gt(delta, '0')) {
      return { onTeam: true, unlock, commissionRecorded: false };
    }

    const { commissionRate, gameRates } = await this.settings.read();
    const category = wagerCategory.resolveCategory({ category: kind?.category, source });
    const gameRate = gameRates?.[category] ?? '0';
    if (!money.gt(commissionRate, '0') || !money.gt(gameRate, '0')) {
      return { onTeam: true, unlock, commissionRecorded: false };
    }

    /**
     * hash.game (Referral → Rate & Rules): commission = wager × 1% × Commission Rate × game rate
     * — Originals 28%, 3rd-party slots and live casino 60%, sports 100%, rate 25% by default.
     * ₹1,000 on an original pays ₹0.70. It replaced a flat 5% of every wager, 20×–71× that.
     *
     * `delta` is USD: `userwager` is counted in USD by the wager-activity pipeline (stakes are
     * converted there, ONCE), so it is not converted again here. The USD commission is then
     * priced in the site's reward currency.
     */
    const commissionUsd = money.toDecimalString(commissionFor(delta, commissionRate, gameRate));
    if (!money.gt(commissionUsd, '0')) {
      return { onTeam: true, unlock, commissionRecorded: false };
    }

    const quote = await this.rewardMoney.fromUsd(commissionUsd);
    const amount = money.toDecimalString(money.toMinor(quote.amount));
    if (!money.gt(amount, '0')) return { onTeam: true, unlock, commissionRecorded: false };
    const referredAmount = money.toDecimalString(money.toMinor(delta));
    const rewardCoin = quote.currency;
    const ownerId = await this.#ownerIdFor(team);

    const created = await this.models.Rewards.create({
      owner_id: ownerId,
      claimed: false,
      voided: false,
      source: source ?? null,
      ref: ref == null ? null : String(ref),
      ownername: team.ownername,
      membername: member.name,
      referalCode: team.referalCode ?? null,
      amount,
      referalmount: referredAmount,
      coin: rewardCoin,
      type: 'commission',
      locked: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    this.logger?.info(
      { owner: team.ownername, member: member.name, deltaUsd: referredAmount, commission: amount, currency: rewardCoin },
      'Affiliate commission recorded'
    );
    void notifyPlayer(ownerId, { kind: 'affiliate_commission', key: `affiliate:commission:${new Date().toISOString().slice(0, 10)}`, title: 'Affiliate commission available', body: 'Your referrals earned you commission. Claim it from the Affiliate page.', link: '/affiliate', meta: { amount, currency: rewardCoin } });

    return {
      onTeam: true,
      unlock,
      commissionRecorded: true,
      commissionId: created?.id != null ? String(created.id) : null,
      commission: amount,
      commissionUsd,
      currency: rewardCoin,
      wagerDelta: referredAmount,
    };
  }

  /**
   * A stake was (partly) refunded / rolled back / voided: its UNCLAIMED commission follows.
   *
   * Called by `wagerActivity` inside its reversal transaction (and again after a late
   * side effect), with the stake's cumulative refunded figure. A partial refund pro-rates the
   * row's payable `amount` (the cut moves to `reversed_amount`); a full reversal voids it.
   * Each row is locked and set to its exact target (`../wager/stakeShare`), so a retry or a
   * race changes nothing twice.
   *
   * NOT clawed back: commission already claimed (paid) — the documented rule. A row being
   * claimed concurrently is safe either way: the claim's conditional UPDATE matches the
   * amount it read, so it pays the old amount before this runs or fails after it.
   *
   * @returns {{ voided: string[], reduced: [{ id, amount }] }}
   */
  async onReverse({ source, ref, reversedAmount, stake, full, transaction }) {
    const out = { voided: [], reduced: [] };
    if (!source || ref == null) return out;
    const rows = await this.models.Rewards.findAll({
      where: { source, ref: String(ref), type: 'commission', claimed: false, voided: false },
      order: [['id', 'ASC']],
      lock: transaction?.LOCK.UPDATE,
      transaction,
      raw: true,
    });
    for (const row of rows) {
      if (full) {
        await this.models.Rewards.update(
          { voided: true },
          { where: { id: row.id, claimed: false, voided: false }, transaction }
        );
        out.voided.push(String(row.id));
        continue;
      }
      const next = settleItem(row, { reversedStake: reversedAmount, stake, full: false });
      if (!next) continue;
      await this.models.Rewards.update(
        { amount: next.amount, reversed_amount: next.reversed },
        { where: { id: row.id, claimed: false, voided: false }, transaction }
      );
      out.reduced.push({ id: String(row.id), amount: next.amount });
    }
    if (out.voided.length || out.reduced.length) {
      this.logger?.info({ source, ref: String(ref), ...out }, 'Affiliate commission reversed with its stake');
    }
    return out;
  }

  /**
   * One-time signup bonuses from site config — register bonus to the member,
   * joining bonus to the referrer once the team row exists.
   *
   * Called only from SELF sign-up (`auth.service` register). Players a staff
   * member creates in the admin are not given the registration bonus: it is a
   * sign-up incentive, and staff who want to fund a player they created credit
   * the wallet directly, which is audited as their action.
   */
  async applyRegistrationBonuses({ userId, referredBy, joined = false }) {
    const settings = await this.settings.read();
    const member = await this.#user(userId);
    const results = { registerBonus: false, affiliateBonus: false };

    // Agent-tree players are funded by their agent only: no registration bonus.
    const agentMember = await promotionsBlocked(userId);
    if (agentMember) {
      this.logger?.info({ userId: String(userId) }, 'Registration bonus skipped: agent-tree player');
    }

    // The site admin's switch decides; an amount stored while it is off pays nobody.
    if (!settings.registerBonusEnabled && money.gt(settings.registerBonus, "0")) {
      this.logger?.info({ userId: String(userId) }, 'Registration bonus skipped: switched off in site config');
    }

    if (!agentMember && settings.registerBonusEnabled && money.gt(settings.registerBonus, "0")) {
      const amount = money.toDecimalString(money.toMinor(settings.registerBonus));
      // The site's reward currency; the operator enters the amount in it.
      const currency = await this.rewardMoney.currency();
      await this.wallet.credit(
        {
          userId,
          currency,
          amount,
          reason: REASON.BONUS,
          idempotencyKey: `affiliate:register-bonus:${userId}`,
          refType: "AFFILIATE_REGISTER_BONUS",
          refId: String(userId),
          description: "Registration bonus",
        },
        { sourceService: "user-service" }
      );
      results.registerBonus = true;
      void notifyBonus(userId, { key: 'affiliate:register-bonus', title: 'Registration bonus', amount, currency });
    }

    if (!joined || !referredBy?.trim() || !money.gt(settings.affiliateBonus, "0")) {
      return results;
    }

    /**
     * Anti-farming (migration 072): with `affiliateBonusRequiresDeposit` on —
     * the default — the joining bonus is NOT booked at sign-up. It is booked by
     * `onRefereeDeposit` once this referee's first deposit is credited.
     */
    if (settings.affiliateBonusRequiresDeposit !== false) {
      results.affiliateBonusDeferred = true;
      return results;
    }

    results.affiliateBonus = await this.#bookJoiningBonus({ member, settings });
    return results;
  }

  /**
   * A referee's deposit was credited — book their referrer's joining bonus if
   * it is waiting on one.
   *
   * Called after EVERY credited deposit on every path (fiat approval, crypto
   * webhook, PSP callbacks — the same point as the first-deposit bonus). It is
   * idempotent: the bonus row is keyed (owner, member, wager_amount = 0), so
   * only the first deposit books it and later ones find it already there.
   * Never throws into a deposit.
   */
  async onRefereeDeposit({ userId }) {
    try {
      const settings = await this.settings.read();
      if (settings.affiliateBonusRequiresDeposit === false) return { booked: false, reason: 'NOT_DEPOSIT_GATED' };
      if (!money.gt(settings.affiliateBonus, '0')) return { booked: false, reason: 'NO_BONUS' };
      if (await promotionsBlocked(userId)) return { booked: false, reason: 'AGENT_TREE_PLAYER' };
      const member = await this.#user(userId);
      const booked = await this.#bookJoiningBonus({ member, settings });
      return { booked, reason: booked ? undefined : 'NOT_ELIGIBLE_OR_ALREADY_BOOKED' };
    } catch (error) {
      this.logger?.warn({ err: error, userId: String(userId) }, 'Affiliate joining bonus on deposit failed — deposit unaffected');
      return { booked: false, reason: 'ERROR' };
    }
  }

  /** Book the referrer's joining bonus for `member` once. True when a row was written. */
  async #bookJoiningBonus({ member, settings }) {
    const team = await this.models.Team.findOne({ where: { membername: member.name }, raw: true });
    if (!team) return false;

    const ownerId = await this.#ownerIdFor(team);
    if (!ownerId) return false;
    const owner = await this.models.Users.findByPk(ownerId, { attributes: ['id', 'name', 'referalcode'], raw: true });
    if (!owner || owner.name !== team.ownername) return false;
    if (await promotionsBlocked(owner.id)) {
      this.logger?.info({ owner: owner.name }, 'Affiliate joining bonus skipped: agent-tree referrer');
      return false;
    }

    const existing = await this.models.UnlockedRewards.findOne({
      where: { uid: owner.id, membername: member.name, wager_amount: '0' },
      raw: true,
    });
    if (existing) return false;

    // Entered by the operator in the site's reward currency; paid as entered.
    const bonus = money.toDecimalString(money.toMinor(settings.affiliateBonus));
    await this.models.UnlockedRewards.create({
      uid: owner.id,
      ownername: owner.name,
      membername: member.name,
      amount: bonus,
      cointype: await this.rewardMoney.currency(),
      referalCode: team.referalCode ?? owner.referalcode,
      wager_amount: '0',
      claimed: false,
    });
    this.logger?.info({ owner: owner.name, member: member.name, amount: bonus }, 'Affiliate joining bonus booked');
    void Promise.resolve().then(() => this.rewardMoney.currency()).catch(() => null).then((currency) => notifyPlayer(owner.id, { kind: 'affiliate_reward', key: `affiliate:joining:${member.name}`, title: 'Referral bonus unlocked', body: `{amount} is ready to claim — ${member.name} joined with your code.`, link: '/affiliate', meta: { amount: bonus, currency } }));
    return true;
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
      referralLink: referralLinkFor(this.config, user.referalcode),
      // hash.game's My Rewards "Locked Rewards" box. Best-effort: the code and link never wait on it.
      lockedRewards: await this.lockedRewards({ ownerName: user.name }).catch((error) => {
        this.logger?.warn({ err: error, userId }, 'Locked referral rewards unreadable');
        return null;
      }),
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

    // Repair any signup that names this owner's exact code in `refree` but has
    // no team row (the insert failed after the account committed). See the
    // method for why usernames are no longer matched.
    await this.#syncOrphanReferralsForOwner(user);

    const { rows, count } = await this.models.Team.findAndCountAll({
      where: { referalCode: user.referalcode },
      order: [['createdAt', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    const memberUsers = await this.#usersByName(rows.map((r) => r.membername));
    const memberIds = [...memberUsers.values()].map((u) => u.id).filter(Boolean);
    const wagerByUid = new Map();
    if (memberIds.length) {
      const wagers = await this.models.Userwager.findAll({
        where: { uid: { [Op.in]: memberIds } },
        attributes: ['uid', 'wager'],
        raw: true,
      });
      for (const w of wagers) wagerByUid.set(Number(w.uid), this.#wagerAmount(w));
    }
    const deposits7d = await this.#deposits7dUsd(memberIds);

    let totalWager = '0';
    const members = rows.map((r) => {
      const member = memberUsers.get(r.membername);
      const wager = member ? wagerByUid.get(Number(member.id)) ?? '0' : '0';
      totalWager = money.toDecimalString(money.add(totalWager, wager));
      const campaignLabel = String(r.campaign ?? '').trim();
      return {
        name: r.membername,
        id: member?.id != null ? String(member.id) : null,
        deposits7dUsd: member ? deposits7d.get(String(member.id)) ?? '0.00000000' : null,
        joinedAt: teamTimestamp(r.createdAt),
        campaign: campaignLabel || user.referalcode || 'Default',
        wager: money.toDecimalString(money.toMinor(wager)),
        wagerCurrency: 'USD',
        level: member?.level ?? null,
        avatar: member?.avatar ?? null,
      };
    });

    return {
      referralCode: user.referalcode,
      total: count,
      totalWager,
      // `userwager` is counted in USD (stakes converted when counted).
      wagerCurrency: 'USD',
      members,
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

  /**
   * @legacy GET /affiliate/unclaimed-rewards/:uid
   *
   * Everything this player can claim: tier unlocks (`unlocked_rewards`) AND
   * commission (`rewards`). Commission was written to `rewards` but only the
   * tier table was ever read here, so it was invisible and never claimable.
   * Each row carries `kind` (`tier` | `commission`) — the claim route needs it
   * because the two tables have independent ids.
   */
  async unclaimedRewards({ userId }) {
    const [tierRows, commissionRows, [tierClaimed], [commissionClaimed], rewardCurrency] = await Promise.all([
      this.models.UnlockedRewards.findAll({
        where: { uid: userId, claimed: false },
        order: [['id', 'DESC']],
        raw: true,
      }),
      this.models.Rewards.findAll({
        where: { owner_id: userId, claimed: false, voided: false },
        order: [['id', 'DESC']],
        raw: true,
      }),
      this.models.UnlockedRewards.findAll({
        attributes: [[fn('COALESCE', fn('SUM', col('amount')), 0), 'total']],
        where: { uid: userId, claimed: true },
        raw: true,
      }),
      this.models.Rewards.findAll({
        attributes: [[fn('COALESCE', fn('SUM', col('amount')), 0), 'total']],
        where: { owner_id: userId, claimed: true },
        raw: true,
      }),
      this.rewardMoney.currency(),
    ]);

    const rows = [
      ...tierRows.map((r) => this.#shapeUnlocked(r, rewardCurrency)),
      ...commissionRows.map((r) => this.#shapeCommission(r, rewardCurrency)),
    ];
    const sum = (list) => list.reduce((acc, r) => money.toDecimalString(money.add(acc, r.amount)), '0');
    const commission = rows.filter((r) => r.kind === 'commission');

    return {
      total: sum(rows),
      commissionTotal: sum(commission),
      claimedTotal: money.toDecimalString(
        money.add(money.toMinor(tierClaimed?.total ?? '0'), money.toMinor(commissionClaimed?.total ?? '0'))
      ),
      currency: rows[0]?.currency ?? rewardCurrency,
      rows,
    };
  }

  /**
   * The Reward History dialog (My Rewards → History): one kind's rewards, claimed or not, newest
   * first. `referral` reads the tier unlocks, `commission` the commission rows.
   */
  async rewardHistory({ userId, kind = 'referral', limit = 50, offset = 0 }) {
    const commission = kind === 'commission';
    const [{ rows, count }, rewardCurrency] = await Promise.all([
      (commission ? this.models.Rewards : this.models.UnlockedRewards).findAndCountAll({
        where: commission ? { owner_id: userId } : { uid: userId },
        order: [['id', 'DESC']],
        limit,
        offset,
        raw: true,
      }),
      this.rewardMoney.currency(),
    ]);
    return {
      total: count,
      rows: rows.map((row) => {
        const shaped = commission ? this.#shapeCommission(row, rewardCurrency) : this.#shapeUnlocked(row, rewardCurrency);
        const status = row.voided ? 'void' : shaped.claimed ? 'claimed' : 'available';
        return { ...shaped, createdAt: row.createdAt ?? null, status };
      }),
    };
  }

  /**
   * @legacy POST /affiliate/claim-reward
   *
   * Claim one reward. `kind` names the table: `tier` (default, the legacy
   * shape) or `commission`.
   */
  async claimReward({ userId, rewardId, kind = 'tier' }) {
    // The route refuses first; this keeps any other caller from paying one.
    await assertPlayerCapability(userId, 'promotions');

    if (kind === 'commission') return this.#claimCommission({ userId, rewardId });

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

      this.logger?.info({ userId, rewardId, amount, currency: paid.payoutCurrency }, 'Affiliate reward claimed');
      return { rewardId, kind: 'tier', amount, currency: paid.payoutCurrency, newBalance: paid.newBalance };
    }).then(afterBonus(userId, (r) => ({ key: `affiliate:claim:tier:${rewardId}`, title: 'Referral reward claimed', amount: r.amount, currency: r.currency, link: '/affiliate' })));
  }

  async #claimCommission({ userId, rewardId }) {
    const row = await this.models.Rewards.findOne({ where: { id: rewardId, owner_id: userId }, raw: true });
    if (!row || row.voided) throw errors.NOT_YOUR_REWARD({ rewardId });
    if (row.claimed) throw errors.ALREADY_CLAIMED({ rewardId });

    const amount = money.toDecimalString(money.toMinor(row.amount ?? '0'));
    return this.db.transaction(async (transaction) => {
      const paid = await this.#payCommission({ userId, row, amount, transaction });
      if (!paid) throw errors.ALREADY_CLAIMED({ rewardId });

      this.logger?.info({ userId, rewardId, amount, currency: paid.payoutCurrency }, 'Affiliate commission claimed');
      return { rewardId, kind: 'commission', amount, currency: paid.payoutCurrency, newBalance: paid.newBalance };
    }).then(afterBonus(userId, (r) => ({ key: `affiliate:claim:commission:${rewardId}`, title: 'Commission claimed', amount: r.amount, currency: r.currency, link: '/affiliate' })));
  }

  /**
   * @legacy POST /affiliate/claim-reward-all
   *
   * Claim everything outstanding — tier rewards and commission.
   *
   * Each reward is claimed by the same conditional update as the single-reward
   * path, so running both concurrently pays each reward exactly once — which
   * legacy did not, because neither guarded its update.
   */
  async claimAllRewards({ userId }) {
    await assertPlayerCapability(userId, 'promotions');
    const [rewards, commissions, rewardCurrency] = await Promise.all([
      this.models.UnlockedRewards.findAll({ where: { uid: userId, claimed: false }, raw: true }),
      this.models.Rewards.findAll({ where: { owner_id: userId, claimed: false, voided: false }, raw: true }),
      this.rewardMoney.currency(),
    ]);

    if (!rewards.length && !commissions.length) throw errors.NOTHING_TO_CLAIM({ userId });

    return this.db.transaction(async (transaction) => {
      const claimed = [];
      const totals = {};

      const add = (shape, amount, currency) => {
        claimed.push({ ...shape, amount, currency });
        totals[currency] = money.toDecimalString(money.add(totals[currency] ?? '0', amount));
      };

      for (const reward of rewards) {
        const amount = money.toDecimalString(money.toMinor(reward.amount ?? '0'));
        const paid = await this.#payReward({ userId, reward, amount, transaction });
        // Someone else claimed this one between the read and now. Skip it
        // rather than failing the whole batch.
        if (!paid) continue;
        add(this.#shapeUnlocked(reward, rewardCurrency), amount, paid.payoutCurrency);
      }

      for (const row of commissions) {
        const amount = money.toDecimalString(money.toMinor(row.amount ?? '0'));
        const paid = await this.#payCommission({ userId, row, amount, transaction });
        if (!paid) continue;
        add(this.#shapeCommission(row, rewardCurrency), amount, paid.payoutCurrency);
      }

      if (!claimed.length) throw errors.NOTHING_TO_CLAIM({ userId });

      const currencies = Object.keys(totals);
      const currency = currencies.length === 1 ? currencies[0] : rewardCurrency;
      const total = totals[currency] ?? '0';

      this.logger?.info({ userId, count: claimed.length, totals }, 'All affiliate rewards claimed');
      return { total, currency, totals, count: claimed.length, rewards: claimed };
      // Nothing left to claim twice once this commits, so the time names the claim.
    }).then(afterBonus(userId, (r) => ({ key: `affiliate:claim-all:${Date.now()}`, title: 'Referral rewards claimed', amount: r.total, currency: r.currency, link: '/affiliate' })));
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
  async joinTeam({ userId, referralCode, campaign = '' }) {
    const member = await this.#user(userId);
    // Affiliate sirf direct users ka — child user (koi parent) kisi team me nahi ja sakta.
    await assertPlayerCapability(member.id, 'promotions');

    const owner = await this.#resolveReferrerOwner(referralCode);
    if (!owner) throw errors.INVALID_REFERRAL_CODE({ referralCode });
    if (Number(owner.id) === Number(userId)) throw errors.CANNOT_REFER_SELF();

    const campaignLabel = String(campaign ?? '').trim().slice(0, 80);

    const [row, created] = await this.models.Team.findOrCreate({
      where: { membername: member.name },
      defaults: {
        ownername: owner.name,
        membername: member.name,
        referalCode: owner.referalcode,
        campaign: campaignLabel,
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
    // Referrer aur member dono direct users hone chahiye (child user ka affiliate nahi).
    await assertPlayerCapability(owner.id, 'promotions');
    await assertPlayerCapability(member.id, 'promotions');

    const wagerRow = await this.models.Userwager.findOne({ where: { uid: member.id }, raw: true });
    const { currency, tiers } = await this.#tiersInDefault();
    // `userwager` is USD; the steps are the admin's figures in the owner's default currency (INR).
    const wager = await this.rewardMoney.convert(this.#wagerAmount(wagerRow), 'USD', currency);
    if (wager == null) return { unlocked: false, reason: `No exchange rate for ${currency}` };
    if (!tiers.some((t) => money.gte(wager, t.wager))) {
      return { unlocked: false, reason: 'The member has not reached the first tier', wager };
    }

    return this.db.transaction(async (transaction) => {
      /**
       * Every tier ABOVE the highest already granted for this member, up to the one the wager
       * has reached — each its own row. hash.game pays a friend's $1,000 in ten steps; paying
       * only the highest step reached skipped the ones a fast climber jumped over.
       *
       * The highest grant is read under a row lock, so two runs cannot both pay a step, and a
       * caller cannot step the figure: the wager comes from `userwager`, not from the request.
       */
      const highest = await this.models.UnlockedRewards.findOne({
        where: { membername: memberName },
        order: [['wager_amount', 'DESC']],
        lock: transaction.LOCK.UPDATE,
        transaction,
        raw: true,
      });
      const floor = String(highest?.wager_amount ?? '0');
      const due = tiers.filter((t) => money.gt(t.wager, floor) && money.gte(wager, t.wager));
      if (!due.length) {
        return { unlocked: false, reason: 'This tier has already been unlocked', tier: floor, wager };
      }

      const granted = [];
      for (const tier of due) {
        // The admin's figure in the default currency, paid in the reward currency (as is when they match).
        const payCoin = await this.rewardMoney.currency();
        const paid = await this.rewardMoney.convert(tier.reward, currency, payCoin);
        if (paid == null) throw new Error(`No exchange rate from ${currency} to ${payCoin}`);
        const quote = { currency: payCoin, amount: money.toDecimalString(money.toMinor(paid)) };
        const created = await this.models.UnlockedRewards.create(
          {
            uid: owner.id,
            ownername: owner.name,
            membername: memberName,
            amount: quote.amount,
            cointype: quote.currency,
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
        granted.push({ rewardId: created.id, level: tier.level, tier: tier.wager, amount: quote.amount, amountUsd: await this.rewardMoney.toUsd(tier.reward, currency), currency: quote.currency });
      }

      this.logger?.info({ owner: owner.name, member: memberName, steps: granted.length, staffId }, 'Affiliate reward unlocked');
      const top = granted[granted.length - 1];
      transaction.afterCommit(() =>
        notifyPlayer(owner.id, {
          kind: 'affiliate_reward',
          key: `affiliate:tier:${memberName}:${top.tier}`,
          title: 'Affiliate reward unlocked',
          body: `{amount} is ready to claim — ${memberName} reached ${top.level || 'a new level'}.`,
          link: '/affiliate',
          meta: { amount: granted.reduce((acc, g) => money.toDecimalString(money.add(acc, g.amount)), '0'), currency: top.currency },
        })
      );

      return {
        unlocked: true,
        rewardId: top.rewardId,
        owner: owner.name,
        member: memberName,
        tier: top.tier,
        amount: top.amount,
        amountUsd: top.amountUsd,
        currency: top.currency,
        granted,
        wager,
      };
    });
  }

  /**
   * The referral unlock table that PAYS: the site admin's (`siteconfig.referral_unlock_tiers`,
   * read through affiliate settings), else `UNLOCK_TIERS`. Each row pays at its OWN total wager,
   * the figure the admin saves and /referral/rules prints; the level name is only a label (taking
   * the VIP ladder's threshold for it silently ignored the admin's edit). The admin's figures are
   * in the owner's default currency (owner panel `default_currency`); the built-in defaults are USD.
   */
  async unlockTiers() {
    const settings = await this.settings.read();
    const table = settings.unlockTiers ?? UNLOCK_TIERS;
    return [...table].sort((a, b) => Number(a.wager) - Number(b.wager));
  }

  /** The owner's default currency (owner panel `default_currency`). */
  async #defaultCurrency() {
    try {
      const row = await this.models.SiteFeature?.findByPk?.('default_currency', { attributes: ['variant'], raw: true });
      return defaultCurrencyOf(row?.variant);
    } catch {
      return defaultCurrencyOf(null);
    }
  }

  /** `{ currency, tiers }`: the steps with wager and reward in the owner's default currency. */
  async #tiersInDefault() {
    const settings = await this.settings.read();
    const currency = await this.#defaultCurrency();
    const tiers = await this.unlockTiers();
    if (settings.unlockTiers || USD_CODES.includes(currency)) return { currency, tiers };
    const inDefault = async (usd) => (await this.rewardMoney.convert(usd, 'USD', currency)) ?? usd;
    return {
      currency,
      tiers: await Promise.all(tiers.map(async (t) => ({ ...t, wager: await inDefault(t.wager), reward: await inDefault(t.reward) }))),
    };
  }

  /**
   * hash.game's "Locked Rewards": what this referrer's friends have not unlocked yet — per friend,
   * the table's total less the steps already granted — in USD and in the owner's default currency.
   */
  async lockedRewards({ ownerName }) {
    const { currency, tiers } = await this.#tiersInDefault();
    const perFriend = tiers.reduce((acc, t) => money.toDecimalString(money.add(acc, t.reward)), '0');
    const usd = async (amount) => money.toDecimalString(money.toMinor((await this.rewardMoney.toUsd(amount, currency)) ?? '0'));
    const members = await this.models.Team.findAll({ where: { ownername: ownerName }, attributes: ['membername'], raw: true });
    if (!members.length) return { friends: 0, perFriend, perFriendUsd: await usd(perFriend), lockedUsd: '0.00000000', locked: '0.00000000', currency };
    const highest = await this.models.UnlockedRewards.findAll({
      where: { ownername: ownerName },
      attributes: ['membername', [fn('MAX', col('wager_amount')), 'top']],
      group: ['membername'],
      raw: true,
    });
    const topOf = new Map(highest.map((r) => [r.membername, String(r.top ?? '0')]));
    let locked = '0';
    for (const { membername } of members) {
      const floor = topOf.get(membername) ?? '0';
      for (const t of tiers) if (money.gt(t.wager, floor)) locked = money.toDecimalString(money.add(locked, t.reward));
    }
    return { friends: members.length, perFriend, perFriendUsd: await usd(perFriend), lockedUsd: await usd(locked), locked: money.toDecimalString(money.toMinor(locked)), currency };
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
      rows: rows.map((r) => ({ member: r.membername, referralCode: r.referalCode, joinedAt: teamTimestamp(r.createdAt) })),
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
      rows: rows.map((r) => ({ owner: r.ownername, member: r.membername, joinedAt: teamTimestamp(r.createdAt) })),
    };
  }

  /**
   * @legacy GET /affiliateAdmin/dashboard-stats
   *
   * Tier rewards AND commission. Commission lives in `rewards` and was left out
   * entirely, so the screen under-reported what the platform owes. Void rows
   * (pre-USD commission, migration 071) are excluded from every figure.
   */
  async dashboardStats() {
    const sums = (model, where) =>
      model.findAll({
        where,
        attributes: [[fn('SUM', col('amount')), 'total'], [fn('COUNT', col('id')), 'count']],
        raw: true,
      });

    const [teams, members, unlocked, claimed, commission, commissionClaimed, currency] = await Promise.all([
      this.models.Team.count({ distinct: true, col: 'ownername' }),
      this.models.Team.count(),
      sums(this.models.UnlockedRewards, {}),
      sums(this.models.UnlockedRewards, { claimed: true }),
      sums(this.models.Rewards, { voided: false }),
      sums(this.models.Rewards, { voided: false, claimed: true }),
      this.rewardMoney.currency(),
    ]);

    const dec = (rows) => money.toDecimalString(money.toMinor(rows[0]?.total ?? '0'));
    const tierTotal = dec(unlocked);
    const tierClaimed = dec(claimed);
    const commissionTotal = dec(commission);
    const commissionPaid = dec(commissionClaimed);
    const unlockedTotal = money.toDecimalString(money.add(tierTotal, commissionTotal));
    const claimedTotal = money.toDecimalString(money.add(tierClaimed, commissionPaid));

    return {
      teams,
      members,
      unlockedCount: Number(unlocked[0]?.count ?? 0) + Number(commission[0]?.count ?? 0),
      unlockedTotal,
      claimedCount: Number(claimed[0]?.count ?? 0) + Number(commissionClaimed[0]?.count ?? 0),
      claimedTotal,
      // What the platform still owes. Legacy's dashboard reported unlocked and
      // claimed separately and never the difference, which is the number that
      // matters on a balance sheet.
      outstanding: money.toDecimalString(money.subtract(unlockedTotal, claimedTotal)),
      tier: { total: tierTotal, claimed: tierClaimed, count: Number(unlocked[0]?.count ?? 0) },
      commission: { total: commissionTotal, claimed: commissionPaid, count: Number(commission[0]?.count ?? 0) },
      currency,
    };
  }

  /**
   * @legacy GET /affiliateAdmin/rewards-list
   *
   * Tier rewards and commission in one list (`kind` narrows it), newest first.
   * The two tables have independent ids, so each row carries `kind`.
   */
  async listRewards({ claimed, owner, kind = 'all', limit = 50, offset = 0 }) {
    const replacements = {
      claimed: claimed === undefined ? null : Boolean(claimed),
      owner: owner ?? null,
      kind,
      limit,
      offset,
    };
    const base = `
      SELECT * FROM (
        SELECT 'tier' AS kind, id, ownername, membername, amount, cointype AS currency,
               wager_amount AS tier, NULL::numeric AS referred, claimed, false AS voided,
               "createdAt" AS created_at
          FROM unlocked_rewards
        UNION ALL
        SELECT 'commission' AS kind, id, ownername, membername, amount, coin AS currency,
               NULL::numeric AS tier, referalmount AS referred, claimed, voided,
               "createdAt" AS created_at
          FROM rewards
      ) x
      WHERE (CAST(:claimed AS boolean) IS NULL OR x.claimed = CAST(:claimed AS boolean))
        AND (CAST(:owner AS text) IS NULL OR x.ownername = CAST(:owner AS text))
        AND (:kind = 'all' OR x.kind = :kind)`;

    const [rows, [{ count }]] = await Promise.all([
      this.db.sequelize.query(`${base} ORDER BY x.created_at DESC NULLS LAST, x.id DESC LIMIT :limit OFFSET :offset`, {
        replacements,
        type: QueryTypes.SELECT,
      }),
      this.db.sequelize.query(`SELECT COUNT(*)::int AS count FROM (${base}) c`, {
        replacements,
        type: QueryTypes.SELECT,
      }),
    ]);

    return {
      total: Number(count),
      rows: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        owner: r.ownername,
        member: r.membername,
        amount: money.toDecimalString(money.toMinorQuantised(r.amount ?? '0')),
        currency: creditableCurrency(r.currency, REWARD_CURRENCY),
        tier: r.tier != null ? String(r.tier) : null,
        referredAmountUsd: r.referred != null ? money.toDecimalString(money.toMinorQuantised(r.referred)) : null,
        claimed: Boolean(r.claimed),
        voided: Boolean(r.voided),
        createdAt: r.created_at,
      })),
    };
  }

  /** @legacy GET /affiliateAdmin/top-affiliates — tier rewards plus (non-void) commission. */
  async topAffiliates({ limit = 20 }) {
    const [rows, currency] = await Promise.all([
      this.db.sequelize.query(
        `SELECT ownername, SUM(amount) AS total, COUNT(*)::int AS rewards FROM (
           SELECT ownername, amount FROM unlocked_rewards
           UNION ALL
           SELECT ownername, amount FROM rewards WHERE voided = false
         ) x GROUP BY ownername ORDER BY SUM(amount) DESC LIMIT :limit`,
        { replacements: { limit }, type: QueryTypes.SELECT }
      ),
      this.rewardMoney.currency(),
    ]);

    return rows.map((r) => ({
      owner: r.ownername,
      rewards: Number(r.rewards),
      total: money.toDecimalString(money.toMinorQuantised(r.total ?? '0')),
      currency,
    }));
  }

  /** @legacy POST /affiliate/rewards/record — staff only; this creates a payable. */
  async recordReward({ ownerName, memberName, referralCode, amount, coin }) {
    const defaultCoin = await this.rewardMoney.currency();
    const ownerId = await this.#ownerIdFor({ ownername: ownerName, referalCode: referralCode });
    // Affiliate sirf direct users ka: owner ya member child user ho to reward nahi.
    if (ownerId) await assertPlayerCapability(ownerId, 'promotions');
    const memberRow = memberName ? await this.models.Users.findOne({ where: { name: memberName }, attributes: ['id'], raw: true }) : null;
    if (memberRow) await assertPlayerCapability(memberRow.id, 'promotions');
    const row = await this.models.Rewards.create({
      // Claimable by the owner through the same path as commission.
      owner_id: ownerId,
      claimed: false,
      voided: false,
      ownername: ownerName,
      membername: memberName,
      referalCode: referralCode,
      amount,
      coin: coin ?? defaultCoin,
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

    // The row's own coin, unless it is blank or retired (a legacy BJB row):
    // those pay in the site's reward currency, because a retired coin cannot be credited.
    const payoutCurrency = creditableCurrency(reward.cointype, await this.rewardMoney.currency());

    const credited = await this.wallet.credit(
      {
        userId,
        currency: payoutCurrency,
        amount,
        reason: REASON.BONUS,
        idempotencyKey: `affiliate:${reward.id}`,
        refType: 'AFFILIATE_REWARD',
        refId: String(reward.id),
        description: `Affiliate reward for ${reward.membername}`,
      },
      { sourceService: 'user-service', transaction }
    );

    return { ...credited, payoutCurrency };
  }

  /**
   * Mark one commission row claimed and pay it — the `rewards` twin of
   * `#payReward`. Conditional on `claimed = false AND voided = false`, and the
   * credit's idempotency key names the row, so it pays exactly once.
   *
   * Also conditional on the `amount` that was read: a partial refund of the stake can
   * pro-rate the row between the read and this update (`onReverse`), and paying the stale,
   * larger figure would pay commission on refunded turnover. Such a row is skipped as
   * "someone else got there" and is claimable again at its new amount.
   */
  async #payCommission({ userId, row, amount, transaction }) {
    const [affected] = await this.models.Rewards.update(
      { claimed: true, claimed_at: new Date() },
      { where: { id: row.id, owner_id: userId, claimed: false, voided: false, amount: row.amount }, transaction }
    );
    if (affected === 0) return null;

    const payoutCurrency = creditableCurrency(row.coin, await this.rewardMoney.currency());
    const credited = await this.wallet.credit(
      {
        userId,
        currency: payoutCurrency,
        amount,
        reason: REASON.BONUS,
        idempotencyKey: `affiliate-commission:${row.id}`,
        refType: 'AFFILIATE_COMMISSION',
        refId: String(row.id),
        description: `Affiliate commission from ${row.membername ?? 'a referral'}`,
      },
      { sourceService: 'user-service', transaction }
    );

    await this.models.Rewards.update(
      { ledger_id: credited?.ledgerId ?? null },
      { where: { id: row.id }, transaction }
    );

    return { ...credited, payoutCurrency };
  }

  /** The referrer's id for a team (or reward) row: code first, then name. */
  async #ownerIdFor({ ownername, referalCode }) {
    if (referalCode) {
      const byCode = await this.models.Users.findOne({ where: { referalcode: referalCode }, attributes: ['id'], raw: true });
      if (byCode) return byCode.id;
    }
    if (!ownername) return null;
    const byName = await this.models.Users.findOne({ where: { name: ownername }, attributes: ['id'], raw: true });
    return byName?.id ?? null;
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

  /** May the team owner named `ownerName` earn nothing (agent-tree player, or a B2B site)? */
  async #ownerHasNoPromotions(ownerName) {
    if (!ownerName) return false;
    const owner = await this.models.Users.findOne({ where: { name: ownerName }, attributes: ['id'], raw: true });
    return owner ? promotionsBlocked(owner.id) : false;
  }

  async #user(userId) {
    const user = await this.models.Users.findByPk(userId, {
      attributes: ['id', 'name', 'referalcode'],
      raw: true,
    });
    if (!user) throw errors.USER_NOT_FOUND({ userId });
    return user;
  }

  /** See `referrerResolver.js` — shared with signup and the public code check. */
  async #resolveReferrerOwner(rawInput) {
    return resolveReferrerOwner(this.models, rawInput);
  }

  /**
   * Create missing `team` rows for accounts whose `refree` is this owner's code.
   *
   * ── WHY ONLY THE EXACT CODE, AND NOT THE OWNER'S NAME ─────────────────
   *
   * This used to match `refree` case-insensitively against the owner's code
   * OR their USERNAME. `refree` was free text — signup stored whatever was
   * typed, even when it resolved to nobody — so a player who typed "bobb"
   * (a typo, or a name not yet taken) could later be claimed by whoever
   * registered "bobb" and opened their team page first, and that account would
   * then earn commission on the player's wagering. It also disagreed with the
   * resolver, which prefers a matching CODE over a matching name.
   *
   * Registration now resolves the referrer before the account exists, refuses
   * a code that resolves to nobody, stores the referrer's canonical
   * `referalcode` in `refree` and creates the team row there and then. So the
   * only rows left for this to repair are (a) signups whose team insert failed
   * after the account committed, and (b) legacy rows that already hold an
   * exact code — both of which carry the canonical code verbatim.
   *
   * Legacy rows holding a USERNAME or a differently-cased code are NOT
   * backfilled any more. That is deliberate: free text cannot prove who was
   * meant. Staff can still attach such a player with `POST /affiliate/team/add`
   * on their behalf after checking.
   */
  async #syncOrphanReferralsForOwner(owner) {
    const code = String(owner.referalcode ?? '').trim();
    if (!code) return;

    const referred = await this.models.Users.findAll({
      where: { id: { [Op.ne]: owner.id }, refree: code },
      attributes: ['id', 'name'],
      raw: true,
    });

    for (const member of referred) {
      const existing = await this.models.Team.findOne({
        where: { membername: member.name },
        raw: true,
      });
      if (existing) continue;

      await this.models.Team.create({
        ownername: owner.name,
        membername: member.name,
        referalCode: code,
        campaign: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      this.logger?.info(
        { owner: owner.name, member: member.name, referralCode: code },
        'Affiliate team row backfilled from refree'
      );
    }
  }

  /**
   * Commission by Friends' "Total Deposits (Past 7D)", in USD per member.
   * shortcut: approved manual deposits + F2Pay only (the deposit rails live uses; admin credits are
   * not deposits); add the other rails from withdrawalCapFigures' DEPOSITED_SQL if a gateway goes live.
   */
  async #deposits7dUsd(ids) {
    const totals = new Map();
    if (!ids.length) return totals;
    const rows = await this.db.sequelize.query(
      `SELECT uid, cur, SUM(amt)::text AS amt FROM (
         SELECT user_id::text AS uid, upper(currency) AS cur, amount AS amt FROM fiat_deposits
          WHERE user_id IN (:ids) AND lower(status) = 'approved' AND COALESCE(handled_at, created_at) >= now() - interval '7 days'
         UNION ALL
         SELECT user_id::text, upper(currency), amount FROM f2paydeposits
          WHERE user_id IN (:ids) AND lower(status) = 'success' AND updated_at >= now() - interval '7 days'
       ) d GROUP BY uid, cur`,
      { replacements: { ids }, type: QueryTypes.SELECT }
    );
    for (const row of rows) {
      const usd = (await this.rewardMoney.toUsd(row.amt, row.cur)) ?? '0';
      totals.set(row.uid, money.toDecimalString(money.add(totals.get(row.uid) ?? '0', usd)));
    }
    return totals;
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

  /** A `rewards` row (commission or staff-recorded) as the player sees it. */
  #shapeCommission(row, fallbackCurrency = REWARD_CURRENCY) {
    return {
      id: row.id,
      kind: 'commission',
      owner: row.ownername,
      member: row.membername,
      amount: money.toDecimalString(money.toMinor(row.amount ?? '0')),
      currency: creditableCurrency(row.coin, fallbackCurrency || REWARD_CURRENCY),
      referredAmountUsd: row.referalmount != null ? money.toDecimalString(money.toMinor(row.referalmount)) : null,
      tier: null,
      claimed: Boolean(row.claimed),
      createdAt: row.createdAt ?? null,
    };
  }

  /** `currency` is what the row PAYS in — a retired coin reads as REWARD_CURRENCY. */
  #shapeUnlocked(row, fallbackCurrency = REWARD_CURRENCY) {
    const code = creditableCurrency(row.cointype, fallbackCurrency || REWARD_CURRENCY);
    return {
      id: row.id,
      kind: 'tier',
      owner: row.ownername,
      member: row.membername,
      amount: money.toDecimalString(money.toMinor(row.amount ?? '0')),
      currency: code || REWARD_CURRENCY,
      tier: row.wager_amount != null ? String(row.wager_amount) : null,
      claimed: Boolean(row.claimed),
    };
  }
}

/**
 * `team."createdAt"` as an ISO instant. The column is `timestamptz` since
 * migration 083 (it was zone-less, and node-pg read it 5h30 early on an IST
 * server), so the driver already hands back the true instant.
 */
function teamTimestamp(value) {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** `wager × 1% × rate% × gameRate%` in minor units — every percent as a decimal string. */
function commissionFor(wagerUsd, ratePercent, gameRatePercent) {
  return money.percentOf(money.toDecimalString(money.percentOf(money.toDecimalString(money.percentOf(wagerUsd, '1')), ratePercent)), gameRatePercent);
}

module.exports = {
  commissionFor, AffiliateService, teamTimestamp };
