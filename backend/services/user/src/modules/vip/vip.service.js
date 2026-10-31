'use strict';

const { Op } = require('sequelize');
const { resolveVipLadder, vipRewards, money, defaultCurrencyOf } = require('@ibitplay/common');
const { promotionsBlocked } = require('@ibitplay/auth');

const { WalletService } = require('../wallet/wallet.service');
const { REASON } = require('../wallet/wallet.constants');
const { createRewardMoney } = require('../../lib/rewardMoney');
const { createRewardFormula, closedWindow } = require('../../lib/rewardFormula');
const { addToUserbonus } = require('../../lib/userbonusTotals');
const { notifyPlayer } = require('../notifications/notifyPlayer');

const {
  PERIOD_MS,
  CLAIM_WINDOW_MS,
  periodicAmount,
  levelUpAmount,
  rankUpAmount,
  rakebackRateForCard,
} = vipRewards;

/**
 * The wallet VIP progression pays into: the site's ONE reward currency
 * (`rewardCurrency()`, chosen by the owner; USDT by default).
 *
 * The ladder and `vipRewards` amounts are designed in USD, and `userwager` is
 * a USD figure, so the level a player holds is currency-independent. Only the
 * PAYMENT is converted — `rewardMoney.fromUsd` at the moment it is credited.
 */

/** The three recurring awards, in the order the ladder pays them. */
const PERIODS = ['daily', 'weekly', 'monthly'];

/**
 * Where a player stands on the ladder — THIS site's ladder.
 *
 * Both reads are thin on purpose: the arithmetic lives in
 * `packages/common/src/vipLadder.js` and the choice of ladder in
 * `vipLadders.js`, both shared with `bonus.service.js`, the profile socket
 * and the operator's reports. That is what keeps the level shown on the VIP
 * page, the level the bonus gates compare against and the level a support
 * agent reads from ever disagreeing.
 */
class VipService {
  constructor(deps) {
    const { models, db, logger } = deps;
    this.models = models;
    this.db = db;
    this.logger = logger;
    /* Built from the same deps every other money path uses, so a VIP credit
       and a bonus claim share one ledger, one idempotency table and one
       guarded UPDATE. */
    this.wallet = new WalletService(deps);
    this.rewardMoney = deps.rewardMoney ?? createRewardMoney(deps);
    this.rewardFormula = deps.rewardFormula ?? createRewardFormula(deps);
  }

  /**
   * A stored wager counter as a number this ladder can be measured against.
   *
   * Same defensive parse as `standing` — legacy wrote "1,234,567.89" into
   * `userwager.wager`, and `Number("1,234")` is NaN, which reads as VIP 0 for
   * the biggest player on the site. `onWager` takes its wagers as ARGUMENTS
   * from casino-service rather than from that column, but they originate
   * there, so they arrive with the same hazard.
   */
  #wager(value) {
    const cleaned = value == null ? '0' : String(value).replace(/,/g, '').trim();
    return /^-?\d+(\.\d+)?$/.test(cleaned) ? cleaned : '0';
  }

  #ladder() {
    return resolveVipLadder(this.models, { logger: this.logger });
  }

  /**
   * rainbet: does this card get this perk (admin → VIP Club → Perks by rank)? Read at most every
   * 10 seconds. An unreadable table pays as before, so a read failure never stops a reward; a perk
   * the admin removed pays nobody.
   */
  async #perkPays(key, card) {
    if (!this.perkCache || Date.now() - this.perkCache.at > 10_000) {
      let rows = null;
      try {
        [rows] = await this.models.Users.sequelize.query('SELECT key, enabled, cards FROM vip_perks WHERE key IS NOT NULL');
      } catch (error) {
        this.logger?.warn({ err: error.message }, 'vip: perks unreadable, paying as before');
      }
      this.perkCache = { at: Date.now(), byKey: rows && new Map(rows.map((r) => [r.key, r])) };
    }
    const { byKey } = this.perkCache;
    if (!byKey) return true;
    const perk = byKey.get(key);
    return Boolean(perk?.enabled && perk.cards?.includes(card));
  }

  /**
   * The ladder. Same for everyone on this site, no login.
   *
   * `maxXp` on the top band is `null` rather than its stored number:
   * `levelFor` treats the last band as OPEN-ENDED — that is the fix for
   * legacy's biggest-player-becomes-VIP-0 bug — so publishing a ceiling there
   * would describe behaviour the platform does not have.
   */
  async levels() {
    const ladder = await this.#ladder();
    return {
      ladder: ladder.key,
      label: ladder.label,
      unranked: ladder.unranked,
      bonusGates: ladder.bonusGates,
      levels: ladder.publish(),
    };
  }

  /**
   * This player's standing.
   *
   * ── `userwager.wager` IS TEXT, AND MAY CARRY THOUSANDS SEPARATORS ──────
   *
   * Legacy wrote "1,234,567.89" into it. `Number("1,234")` is NaN, so a missed
   * `replace` here silently makes every player VIP 0 — the same trap
   * `bonus.service.js`'s `#wagerAmount` documents, and the reason this parses
   * rather than casts. Anything that is not a plain decimal after the strip is
   * treated as no wager, which is the honest reading of an unparseable counter.
   */
  async standing(userId) {
    const [ladder, row] = await Promise.all([
      this.#ladder(),
      this.models.Userwager.findOne({ where: { uid: userId }, raw: true }),
    ]);

    const raw = row?.wager;
    const cleaned = raw == null ? '0' : String(raw).replace(/,/g, '').trim();
    const wager = /^-?\d+(\.\d+)?$/.test(cleaned) ? cleaned : '0';

    const standing = { ...ladder.levelFor(wager), ladder: ladder.key, totalLevels: ladder.levels.length };
    return { ...standing, ...(await this.#inDefaultCurrency(standing)) };
  }

  /**
   * The standing's money valued in the owner's DEFAULT COIN (`default_currency` policy, USDT
   * unless the owner picks another) — what the site shows VIP progress in before the player's
   * own selected currency is applied.
   *
   * ── THE LEVEL ITSELF STAYS IN USD ────────────────────────────────────────
   * `userwager` counts every stake converted to USD when it was placed, from every currency the
   * player bets in, and the ladder's bands are designed in USD. The level is decided on that
   * stored USD total, never on a converted figure, so a rate move can never drop a player a
   * level or hand one out. Only the DISPLAY is converted, at today's rate: `currency`,
   * `wagerInCurrency`, `wagerToNextLevelInCurrency`. `wager` / `wagerToNextLevel` stay USD, as
   * the admin's VIP and report screens read them ("USD by design"). USD and USDT are 1:1 when the
   * rate table has no row for them; a default coin with no rate reports USD.
   */
  async #inDefaultCurrency(standing) {
    let code = 'USDT';
    try {
      const row = await this.models.SiteFeature?.findByPk?.('default_currency', { attributes: ['variant'], raw: true });
      code = defaultCurrencyOf(row?.variant);
    } catch {
      /* keep USDT */
    }
    let rate = null;
    if (code === 'USD' || code === 'USDT') rate = '1';
    try {
      // Case-insensitive: a row stored as `inr` / `Inr` is still the INR rate.
      const fx = await this.models.Exchangerate?.findOne?.({
        where: this.db.sequelize.where(this.db.sequelize.fn('upper', this.db.sequelize.col('currency')), String(code).toUpperCase()),
        attributes: ['usd_rate'],
        raw: true,
      });
      if (fx?.usd_rate && Number(fx.usd_rate) > 0) rate = String(fx.usd_rate);
    } catch {
      /* fall through */
    }
    if (!rate) return { currency: 'USD', wagerInCurrency: standing.wager, wagerToNextLevelInCurrency: standing.wagerToNextLevel };
    const convert = (usd) =>
      usd == null ? null : money.toDecimalString(money.divide(money.toDecimalString(money.toMinorQuantised(String(usd))), rate));
    return {
      currency: code,
      wagerInCurrency: convert(standing.wager),
      wagerToNextLevelInCurrency: convert(standing.wagerToNextLevel),
    };
  }

  /**
   * casino-service calls this after every stake that moves `userwager`.
   *
   * Three things happen, in this order, and the order matters:
   *
   *   1. the player's rakeback RATE is synced to their current card;
   *   2. one `levelUp` credit per level gained;
   *   3. one `rankUp` credit per card climbed into.
   *
   * ── THE WAGERS ARE ARGUMENTS, NOT A READ ────────────────────────────────
   *
   * `previousWager` and `newWager` come from the caller because casino-service
   * has just written the new total and holds both sides of the move. Reading
   * `userwager` here instead would race that write and, worse, would make the
   * method unable to tell a level GAIN from a level the player already had —
   * and the difference between those two is whether money is paid.
   *
   * ── …EXCEPT THE RAKEBACK RATE, WHICH IS A READ UNDER THE ROW LOCK ──────
   *
   * The rate is a level, not a payment, so it must follow the CURRENT total,
   * not this call's `newWager`. Two stakes counted together run their side
   * effects out of order; syncing from the argument let the lower stake's
   * call land last and write a lower card's rate over the higher one. It is
   * now derived from `userwager` read `FOR UPDATE` (`syncRakebackRate`), so
   * whichever call runs last writes the rate of the latest total.
   *
   * ── WHY THE RATE IS A GUARDED UPDATE ────────────────────────────────────
   *
   * This runs on every settled bet. `WHERE rakeback <> :rate` means the common
   * case — a player whose card has not moved — writes no row at all, instead
   * of one UPDATE per bet per player for a value that did not change.
   *
   * ── WHY NOTHING HERE PAYS TWICE ─────────────────────────────────────────
   *
   * Each credit carries an `idempotencyKey` naming the thing being paid for
   * rather than this call: `vip:level_up:<user>:<level>` and
   * `vip:rank_up:<user>:<card>`. A level can only be reached once, so a
   * retried call, a duplicated settlement, or two overlapping wagers that
   * cross the same band all collapse onto the same key and the wallet pays
   * once. That is the same mechanism `bonus.claim` uses (`bonus:<award id>`),
   * and it is stronger than checking the level first, because the check and
   * the credit cannot be made atomic from here.
   *
   * ── ENTERING THE LADDER IS NOT A RANK-UP ────────────────────────────────
   *
   * `unranked → wood` pays the Wood `levelUp` and nothing else; a rank-up is
   * a move from one RANKED card to another, so it is `wood → bronze` that
   * pays Bronze's `rankUp`. That is what `vip.test.js` pins: crossing into
   * Wood leaves exactly `0.50000000`, which is the Wood level-up alone, while
   * a jump to Bronze 1 must report both kinds. Paying Wood's `rankUp` on the
   * way in would make every new player's first bet worth an extra unit.
   */
  /**
   * Set `users.rakeback` to the rate of the card the player's stored wager
   * total is on — read under the `userwager` row lock, so concurrent syncs
   * serialise and the last one always sees the newest total. Also called after
   * a reversal (`wagerActivity.reverse`), which can drop the player a card.
   *
   * `fallbackWager` is used only when the player has no `userwager` row yet.
   */
  async syncRakebackRate(userId, { fallbackWager = '0', ladder = null } = {}) {
    const vipLadder = ladder ?? (await this.#ladder());
    return this.db.transaction(async (transaction) => {
      const row = await this.models.Userwager.findOne({
        where: { uid: userId },
        attributes: ['uid', 'wager'],
        transaction,
        lock: transaction.LOCK.UPDATE,
        raw: true,
      });
      const total = this.#wager(row ? row.wager : fallbackWager);
      const standing = vipLadder.levelFor(total);
      const rate = (await this.#perkPays('rakeback', standing.card)) ? rakebackRateForCard(standing.card) : '0';
      await this.models.Users.update(
        { rakeback: rate },
        { where: { id: userId, rakeback: { [Op.ne]: rate } }, transaction }
      );
      return { rate, card: standing.card, level: standing.level };
    });
  }

  async onWager({ userId, previousWager, newWager }) {
    if (!userId) return { vip: null, rate: null, granted: [] };

    const ladder = await this.#ladder();
    const before = ladder.levelFor(this.#wager(previousWager));
    const after = ladder.levelFor(this.#wager(newWager));

    const { rate } = await this.syncRakebackRate(userId, { fallbackWager: newWager, ladder });

    /* Wager went nowhere, or nowhere that crosses a band. Nothing is owed. */
    if (!(after.level > before.level)) {
      return { vip: after, rate, granted: [] };
    }

    /* The bands actually gained, in order — the ones that may pay. */
    const climbed = [];
    for (let level = before.level + 1; level <= after.level; level += 1) {
      const band = ladder.levels.find((b) => b.level === level);
      if (band) climbed.push(band);
    }

    /* Decide every payment before writing any, so the transaction is short. */
    const due = [];
    for (const band of climbed) {
      const amount = levelUpAmount(band.level, band.card);
      if (money.gt(amount, '0')) {
        due.push({
          kind: 'level_up',
          level: band.level,
          card: band.card,
          amount: money.toDecimalString(money.toMinor(amount)),
          idempotencyKey: `vip:level_up:${userId}:${band.level}`,
          description: `VIP ${band.name} level-up`,
          refId: String(band.level),
        });
      }
    }

    let fromCard = before.card;
    let fromLevel = before.level;
    for (const band of climbed) {
      if (band.card !== fromCard) {
        /* `fromLevel > 0` is the ranked test — level 0 is Unranked, and
           leaving it is getting ranked, not ranking up. */
        const amount = fromLevel > 0 ? rankUpAmount(band.card) : '0';
        if (money.gt(amount, '0')) {
          due.push({
            kind: 'rank_up',
            level: band.level,
            card: band.card,
            amount: money.toDecimalString(money.toMinor(amount)),
            idempotencyKey: `vip:rank_up:${userId}:${band.card}`,
            description: `VIP ${band.card} rank-up`,
            refId: band.card,
          });
        }
        fromCard = band.card;
      }
      fromLevel = band.level;
    }

    if (due.length === 0) return { vip: after, rate, granted: [] };

    /* Agent-tree players (owner at staff level 4–6) have no promotions: the
       level still moves, nothing is credited. `packages/auth/src/agentPlayers.js`. */
    if (await promotionsBlocked(userId)) {
      this.logger?.info(
        { userId: String(userId), skipped: due.map((d) => d.idempotencyKey) },
        'VIP progression not credited: agent-tree player'
      );
      return { vip: after, rate, granted: [], skipped: 'AGENT_TREE_PLAYER' };
    }

    /* USD table amounts → the reward currency, priced before the transaction. */
    for (const award of due) {
      const quote = await this.rewardMoney.fromUsd(award.amount);
      award.usd = award.amount;
      award.amount = quote.amount;
      award.currency = quote.currency;
    }

    const granted = await this.db.transaction(async (transaction) => {
      const paid = [];
      for (const award of due) {
        const movement = await this.wallet.credit(
          {
            userId,
            currency: award.currency,
            amount: award.amount,
            reason: REASON.BONUS,
            idempotencyKey: award.idempotencyKey,
            refType: award.kind === 'level_up' ? 'VIP_LEVEL_UP' : 'VIP_RANK_UP',
            refId: award.refId,
            description: award.description,
          },
          { sourceService: 'user-service', transaction }
        );

        /* The admin Bonus screen reads `userbonus.vipbonus`/`totalbonus`;
           mirrored once per real payment (not on a replay). */
        if (!movement?.replayed) {
          await addToUserbonus(this, userId, { vipbonus: award.amount, totalbonus: award.amount }, { transaction });
        }

        paid.push({
          kind: award.kind,
          level: award.level,
          card: award.card,
          amount: award.amount,
          amountUsd: award.usd,
          currency: award.currency,
          /* A replay reports the grant but flags that no new money moved, so
             a caller can tell "paid now" from "already paid". The wallet
             names this `replayed` — see `#describeReplay`, which returns the
             ORIGINAL ledger row rather than writing a second one. */
          replayed: Boolean(movement?.replayed),
        });
      }
      return paid;
    });

    this.logger?.info(
      { userId: String(userId), from: before.level, to: after.level, granted: granted.length },
      'VIP progression credited'
    );
    void notifyPlayer(userId, granted.filter((g) => !g.replayed).map((g) => ({
      kind: g.kind === 'level_up' ? 'vip_level_up' : 'vip_rank_up',
      key: `vip:${g.kind}:${g.kind === 'level_up' ? g.level : g.card}`,
      title: g.kind === 'level_up' ? `VIP level ${g.level} reached` : `New VIP rank: ${g.card}`,
      body: '{amount} VIP reward has been added to your wallet.',
      link: '/vip',
      meta: { amount: g.amount, currency: g.currency, level: g.level, card: g.card },
    })));

    return { vip: after, rate, granted };
  }

  /**
   * The most recent award of each recurring type, as rows.
   *
   * One query for all three rather than three — `bonus_history` is the whole
   * platform's award table and a per-type round trip on every `/user/bonus`
   * read is three index scans where one does.
   */
  async #latestAwards(userId) {
    const rows = await this.models.BonusClaim.findAll({
      where: { userid: userId, bonus_type: { [Op.in]: PERIODS } },
      order: [['created_at', 'DESC']],
      raw: true,
    });

    const latest = {};
    for (const row of rows) {
      if (!latest[row.bonus_type]) latest[row.bonus_type] = row;
    }
    return latest;
  }

  /**
   * When each recurring award next becomes due.
   *
   * `{ daily, weekly, monthly }` of ISO timestamps, or `null` per type where
   * nothing has been awarded yet — the card then reads "Wager to Unlock"
   * rather than counting down to a date that was never set. Null is also the
   * answer for a type this player's card does not pay at all.
   *
   * A READ. It reports what the award rows already say; `awardPeriodic` is the
   * only thing that writes them.
   */
  async nextClaimTimes({ userId, vip }) {
    const latest = await this.#latestAwards(userId);
    const card = vip?.card;

    const out = {};
    for (const type of PERIODS) {
      const pays = card && periodicAmount(card, type) !== '0' && (await this.#perkPays(type, card));
      const last = latest[type]?.created_at;
      out[type] = pays && last ? new Date(new Date(last).getTime() + PERIOD_MS[type]).toISOString() : null;
    }
    return out;
  }

  /**
   * Write any recurring award that has come due for this player.
   *
   * ── WHAT "DUE" MEANS ────────────────────────────────────────────────────
   *
   * One award per period per type. The last row of that type is the clock: if
   * it was written less than `PERIOD_MS[type]` ago the period has not rolled,
   * so nothing is written. With no row at all the first award is due now,
   * which is how a player who has just reached a paying card gets their first
   * one without waiting a full period for it.
   *
   * The amount comes from the player's CURRENT card — `vipRewards.CARD_REWARDS`
   * — so a card that pays nothing for a period (every card for `monthly` below
   * Silver, say) writes nothing rather than a zero-value row a player could
   * "claim" for nothing.
   *
   * ── IT IS CALLED FROM A READ, SO IT HAS TO BE CHEAP AND IDEMPOTENT ──────
   *
   * `bonus.service.js#overview` calls this before it reports, which is what
   * makes the cards correct on a page load rather than only after a worker
   * has run. Two overlapping reads must not produce two awards: the insert is
   * guarded by the same period check inside a transaction that locks the
   * player's rows of that type, so the second read finds the first's row.
   */
  async awardPeriodic({ userId }) {
    if (!userId) return { awarded: 0, rows: [] };

    const vip = await this.standing(userId);
    if (!vip?.card) return { awarded: 0, rows: [] };

    // No recurring VIP awards for agent-tree players (no promotions).
    if (await promotionsBlocked(userId)) return { awarded: 0, rows: [] };

    const rows = [];
    const now = Date.now();
    const formula = await this.rewardFormula();
    if (formula.mode === 'hash') return this.#awardHashPeriodic({ userId, vip, formula });

    for (const type of PERIODS) {
      const amount = periodicAmount(vip.card, type);
      if (!amount || amount === '0') continue;
      if (!(await this.#perkPays(type, vip.card))) continue;

      try {
        await this.models.BonusClaim.sequelize.transaction(async (transaction) => {
          await this.#lockAward(userId, type, transaction);
          const last = await this.models.BonusClaim.findOne({
            where: { userid: userId, bonus_type: type },
            order: [['created_at', 'DESC']],
            transaction,
            lock: transaction.LOCK.UPDATE,
          });

          if (last && now - new Date(last.created_at).getTime() < PERIOD_MS[type]) return;

          await this.models.BonusClaim.create(
            {
              userid: userId,
              bonus_type: type,
              bonus_amount: amount,
              wager_change: '0',
              claim_deadline: new Date(now + CLAIM_WINDOW_MS[type]),
              is_claimed: false,
              is_unclaimable: false,
            },
            { transaction }
          );

          rows.push({ type, amount });
        });
      } catch (error) {
        /*
         * A failed award must not fail the read that triggered it. The player
         * sees the cards they already had; the next read tries again.
         */
        this.logger?.warn({ err: error, userId: String(userId), type }, 'Periodic VIP award failed');
      }
    }

    /*
     * `awarded` is a COUNT, not the rows — that is the contract every caller
     * was already written against: `vip.test.js` asserts `awarded >= 2` on the
     * first sweep and `awarded === 0` on the second, and an array satisfies
     * neither (`[obj, obj] >= 2` is a NaN comparison, so it is quietly false).
     * The rows ride along under their own key for the internal route, which
     * returns this body straight to an operator who wants to see WHICH awards
     * landed; both `bonus.service.js` call sites discard the value entirely.
     */
    return { awarded: rows.length, rows };
  }

  /**
   * hash.game's Daily / Weekly / Monthly bonus (migration 137), for the period that has just
   * CLOSED (UTC): Daily = wagered × house edge × 4%; Weekly (Fri–Thu) = … × 4% + net loss × 1%;
   * Monthly (15th–14th) = … × 3.5% + net loss × 1.5%. Bronze I and up. One row per closed
   * window (a row created at or after the window's end means it is done). Amounts in USD, like
   * every `bonus_history.bonus_amount`; claimed in the reward currency.
   */
  async #awardHashPeriodic({ userId, vip, formula }) {
    const rows = [];
    if (!(Number(vip.level) >= 1)) return { awarded: 0, rows };
    const rates = {
      daily: { wager: formula.daily ?? '4', loss: '0' },
      weekly: { wager: formula.weeklyWager ?? '4', loss: formula.weeklyLoss ?? '1' },
      monthly: { wager: formula.monthlyWager ?? '3.5', loss: formula.monthlyLoss ?? '1.5' },
    };
    for (const type of PERIODS) {
      if (!(await this.#perkPays(type, vip.card))) continue;
      try {
        const { start, end } = closedWindow(type);
        const done = await this.models.BonusClaim.findOne({
          where: { userid: userId, bonus_type: type, created_at: { [Op.gte]: end } },
          attributes: ['id'],
          raw: true,
        });
        if (done) continue;
        const { edgeUsd, netLossUsd } = await this.#windowFigures(userId, start, end);
        const amount = money.toDecimalString(
          money.add(
            money.toDecimalString(money.percentOf(edgeUsd, rates[type].wager)),
            money.toDecimalString(money.percentOf(netLossUsd, rates[type].loss))
          )
        );
        if (!money.gt(amount, '0')) continue;
        await this.models.BonusClaim.sequelize.transaction(async (transaction) => {
          await this.#lockAward(userId, type, transaction);
          const again = await this.models.BonusClaim.findOne({
            where: { userid: userId, bonus_type: type, created_at: { [Op.gte]: end } },
            transaction,
            lock: transaction.LOCK.UPDATE,
          });
          if (again) return;
          await this.models.BonusClaim.create(
            {
              userid: userId,
              bonus_type: type,
              bonus_amount: amount,
              wager_change: edgeUsd,
              claim_deadline: new Date(Date.now() + CLAIM_WINDOW_MS[type]),
              is_claimed: false,
              is_unclaimable: false,
            },
            { transaction }
          );
          rows.push({ type, amount, from: start.toISOString(), to: end.toISOString() });
        });
      } catch (error) {
        this.logger?.warn({ err: error, userId: String(userId), type }, 'Periodic VIP award (hash formula) failed');
      }
    }
    return { awarded: rows.length, rows };
  }

  /**
   * One awarder per (player, period type) at a time, released at commit. The FOR UPDATE reads
   * below lock nothing when the period's row does not exist yet (no gap locks under READ
   * COMMITTED), so two overlapping reads could each insert one; after this wait the re-check
   * sees the first's committed row.
   */
  async #lockAward(userId, type, transaction) {
    await this.models.BonusClaim.sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:key))', {
      replacements: { key: `vip-award:${userId}:${type}` },
      transaction,
    });
  }

  /**
   * Σ usd × house edge of the counted (unreversed part of) stakes in `[start, end)`, and the net
   * loss there: −Σ of bet movements on the ledger (stakes negative, payouts / refunds positive),
   * in USD at today's rates. A net win is 0 loss.
   */
  async #windowFigures(userId, start, end) {
    const sequelize = this.models.BonusClaim.sequelize;
    const [edge] = await sequelize.query(
      `SELECT COALESCE(SUM(
                usd_amount * (1 - COALESCE(reversed_amount, 0) / NULLIF(amount, 0))
                * COALESCE(house_edge, CASE category WHEN 'originals' THEN 0.01 WHEN 'live' THEN 0.02 WHEN 'sports' THEN 0.02 ELSE 0.04 END)
              ), 0)::text AS edge
         FROM wager_activity
        WHERE user_id = :userId AND created_at >= :start AND created_at < :end AND reversed_at IS NULL`,
      { replacements: { userId: String(userId), start, end }, type: 'SELECT' }
    );
    const [loss] = await sequelize.query(
      `SELECT COALESCE(-SUM(l.amount * COALESCE(e.usd_rate, CASE WHEN upper(l.currency) IN ('USD', 'USDT') THEN 1 END, 0)), 0)::text AS loss
         FROM public.credits_ledger l
         LEFT JOIN exchangerate e ON upper(e.currency) = upper(l.currency)
        WHERE l.user_id = :userId AND l.created_at >= :start AND l.created_at < :end
          AND l.reason IN ('BET_STAKE', 'BET_PAYOUT', 'BET_REFUND', 'BET_ROLLBACK')`,
      { replacements: { userId: String(userId), start, end }, type: 'SELECT' }
    );
    const edgeUsd = money.toDecimalString(money.toMinorQuantised(edge?.edge ?? '0'));
    const lossRaw = money.toDecimalString(money.toMinorQuantised(loss?.loss ?? '0'));
    return { edgeUsd, netLossUsd: money.gt(lossRaw, '0') ? lossRaw : '0.00000000' };
  }

  /**
   * Write every recurring award that has come due, for every player.
   *
   * ── WHY THIS EXISTS WHEN `overview` ALREADY MATERIALISES AWARDS ─────────
   *
   * `bonus.service.js#overview` calls `awardPeriodic` for the player doing the
   * reading, which is what makes the cards correct the moment somebody opens
   * the VIP page. That covers everyone who LOOKS. It does not cover the player
   * who stops visiting for a fortnight and comes back expecting the daily
   * awards they were owed, and it does not cover the operator's reports, which
   * read `bonus_history` rather than calling anything.
   *
   * `internal.routes.js` has described this as "the same work the worker runs
   * on an interval" since the module was written, and no worker ran it — the
   * manifest declared no jobs at all. This is that work.
   *
   * ── IT SKIPS THE MAJORITY WITHOUT ASKING THE DATABASE ABOUT THEM ────────
   *
   * Only Bronze and above are paid anything: every period on `unranked` and
   * `wood` is '0'. So the band is computed here from the wager row already in
   * hand and non-paying players are dropped before `awardPeriodic` — which
   * would otherwise spend a `standing` query per player to reach the same
   * conclusion. On a real book that is the difference between a handful of
   * writes and one query per account per tick.
   *
   * `limit` caps the PAYING players visited in one tick, not the rows scanned,
   * so a slow sweep cannot pile ticks on top of each other. The count is a
   * ceiling rather than a cursor: awards are idempotent per period, so the
   * next tick redoing the same players costs an indexed read each and reaches
   * the ones it missed as soon as the earlier ones stop being due.
   */
  async sweepPeriodic({ limit = 500, batchSize = 200 } = {}) {
    const ladder = await this.#ladder();
    const pays = (card) => PERIODS.some((type) => periodicAmount(card, type) !== '0');

    let scanned = 0;
    let eligible = 0;
    let awarded = 0;
    let offset = 0;

    while (eligible < limit) {
      const rows = await this.models.Userwager.findAll({
        order: [['uid', 'ASC']],
        limit: batchSize,
        offset,
        raw: true,
      });
      if (!rows.length) break;
      offset += rows.length;

      for (const row of rows) {
        scanned += 1;
        if (!pays(ladder.levelFor(this.#wager(row.wager)).card)) continue;

        eligible += 1;
        const result = await this.awardPeriodic({ userId: row.uid });
        awarded += result.awarded;
        if (eligible >= limit) break;
      }
    }

    if (awarded) {
      this.logger?.info({ scanned, eligible, awarded }, 'Periodic VIP awards swept');
    }
    return { scanned, eligible, awarded };
  }
}

module.exports = { VipService };
