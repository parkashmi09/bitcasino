'use strict';

const { QueryTypes } = require('sequelize');

/**
 * Every read and write the medals module makes. Each fact is one indexed (or
 * one-player) query; nothing scans a whole table except the wager record, which
 * reads `userwager` (one row per player that has wagered) once.
 */

/* `userwager.wager` is TEXT and legacy wrote "1,234.5" into it; anything that
   is not a plain decimal after dropping commas counts as 0 rather than failing
   the cast. Same defensive parse as the VIP service. */
const WAGER_NUMERIC = `CASE WHEN replace(trim(wager), ',', '') ~ '^[0-9]+(\\.[0-9]+)?$'
                            THEN replace(trim(wager), ',', '')::numeric ELSE 0 END`;

class MedalsRepository {
  constructor({ models, db }) {
    this.models = models;
    this.db = db;
  }

  #select(sql, replacements) {
    return this.db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
  }

  async findUser(userId) {
    return this.models.Users.findByPk(userId, { attributes: ['id', 'created'], raw: true });
  }

  /** Lifetime wager in USD (the VIP figure), as a decimal string. */
  async wagerUsd(userId) {
    const [row] = await this.#select(`SELECT (${WAGER_NUMERIC})::text AS wager FROM userwager WHERE uid = :userId LIMIT 1`, { userId });
    return row?.wager ?? '0';
  }

  /** The highest lifetime wager of any OTHER player, or '0'. */
  async topOtherWager(userId) {
    const [row] = await this.#select(
      `SELECT COALESCE(MAX(${WAGER_NUMERIC}), 0)::text AS top FROM userwager WHERE uid <> :userId`,
      { userId }
    );
    return row?.top ?? '0';
  }

  /** Distinct UTC days with at least one chat message, across both rooms. */
  async chatDays(userId) {
    const [row] = await this.#select(
      `SELECT COUNT(*)::int AS days FROM (
         SELECT (date AT TIME ZONE 'UTC')::date AS d FROM chat_global WHERE uid = :userId AND date IS NOT NULL
         UNION
         SELECT (date AT TIME ZONE 'UTC')::date FROM chat_brazil WHERE uid = :userId AND date IS NOT NULL
       ) t`,
      { userId }
    );
    return Number(row?.days ?? 0);
  }

  /** How many different players this player has tipped (`ix_tips_from_created`). */
  async tipRecipients(userId) {
    const [row] = await this.#select(
      'SELECT COUNT(DISTINCT to_user_id)::int AS n FROM tips WHERE from_user_id = :userId',
      { userId }
    );
    return Number(row?.n ?? 0);
  }

  /** The UTC days of every daily race this player finished in the top 3, ascending. */
  async dailyRaceTop3Days(userId) {
    const rows = await this.#select(
      `SELECT DISTINCT to_char((r.starts_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day
         FROM race_rewards rr
         JOIN races r ON r.id = rr.race_id
        WHERE rr.user_id = :userId AND rr.type = 'daily' AND rr.rank BETWEEN 1 AND 3
        ORDER BY 1`,
      { userId }
    );
    return rows.map((r) => r.day);
  }

  /** The player's held medals: `key → unlocked_at`. */
  async held(userId) {
    const rows = await this.models.UserMedal.findAll({ where: { user_id: userId }, raw: true });
    return new Map(rows.map((r) => [r.sub_type === '0' ? String(r.medal_type) : `${r.medal_type}_${r.sub_type}`, r.unlocked_at]));
  }

  /** Insert newly met medals; one already held is left as it is (its date kept). */
  async unlock(userId, medals) {
    if (!medals.length) return;
    await this.models.UserMedal.bulkCreate(
      medals.map((m) => ({ user_id: userId, medal_type: m.type, sub_type: m.subType, unlocked_at: m.at })),
      { ignoreDuplicates: true }
    );
  }

  /** How many players hold each medal: `key → count`. */
  async holderCounts() {
    const rows = await this.#select(
      'SELECT medal_type, sub_type, COUNT(*)::int AS n FROM user_medals GROUP BY medal_type, sub_type'
    );
    return new Map(rows.map((r) => [r.sub_type === '0' ? String(r.medal_type) : `${r.medal_type}_${r.sub_type}`, Number(r.n)]));
  }
}

module.exports = { MedalsRepository };
