'use strict';

const crypto = require('node:crypto');
const { QueryTypes } = require('sequelize');
const { imageUpload, resolveVipLadder, clearVipBranding, VIP_LADDERS } = require('@ibitplay/common');

const errors = require('./vipBranding.errors');

const MAX_BADGE_BYTES = 1024 * 1024;
const PAYING_PERKS = new Set(['rakeback', 'daily', 'weekly', 'monthly']);
const versionOf = (data) => crypto.createHash('sha256').update(data).digest('hex').slice(0, 12);

class VipBrandingService {
  constructor({ models, logger }) {
    this.models = models;
    this.logger = logger;
  }

  get sequelize() {
    return this.models.Users.sequelize;
  }

  #select(sql, replacements) {
    return this.sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
  }

  /** Every level the admin can manage, switched off ones included, lowest first (level 0 apart). */
  async #allLevels(ladder) {
    const builtIn = VIP_LADDERS[ladder.key] ?? ladder;
    const stored = await this.#select('SELECT level, name, min_xp, enabled, card FROM vip_level_names');
    const row = new Map(stored.map((r) => [Number(r.level), r]));
    const shown = (b) => {
      const r = row.get(b.level);
      return { level: b.level, name: r?.name ?? b.name, defaultName: b.name, card: b.card, minXp: r?.min_xp != null ? String(Number(r.min_xp)) : String(b.minXp), enabled: r?.enabled !== false, custom: false };
    };
    const added = stored
      .filter((r) => r.card != null && r.min_xp != null && !builtIn.levels.some((b) => b.level === Number(r.level)))
      .map((r) => ({ level: Number(r.level), name: r.name, defaultName: r.name, card: r.card, minXp: String(Number(r.min_xp)), enabled: r.enabled !== false, custom: true }));
    return [...builtIn.levels.map(shown), ...added].sort((a, b) => a.level - b.level);
  }

  /** Staff view: every level with its current and built-in name, and every card's badge. */
  async view() {
    clearVipBranding();
    const ladder = await resolveVipLadder(this.models, { logger: this.logger });
    const all = await this.#allLevels(ladder);
    const unranked = { level: 0, name: ladder.unranked.name, defaultName: (VIP_LADDERS[ladder.key] ?? ladder).unranked.name, card: ladder.unranked.card, minXp: null, enabled: true, custom: false };
    const levels = [unranked, ...all];
    const cards = [...new Set(levels.map((l) => l.card))];
    const badgeOf = new Map([ladder.unranked, ...ladder.levels].map((b) => [b.card, b.badgeUrl ?? null]));
    return { ladder: ladder.key, levels, badges: cards.map((card) => ({ card, url: badgeOf.get(card) ?? null })) };
  }

  /** A threshold must sit between the switched-on levels around it, or the ladder breaks. */
  #assertFits(all, level, minXp) {
    const on = all.filter((b) => b.enabled && b.level !== level);
    const below = on.filter((b) => b.level < level).at(-1);
    const above = on.find((b) => b.level > level);
    if ((below && Number(minXp) <= Number(below.minXp)) || (above && Number(minXp) >= Number(above.minXp))) {
      throw errors.BAD_THRESHOLD({ level, minXp, below: below?.minXp ?? null, above: above?.minXp ?? null });
    }
  }

  /** A new level goes on top: level numbers climb with thresholds and reward keys use them, so none is ever renumbered. */
  async addLevel({ staff, name, minXp, card }) {
    const ladder = await resolveVipLadder(this.models, { logger: this.logger });
    const all = await this.#allLevels(ladder);
    if (!all.some((b) => b.card === card)) throw errors.BAD_CARD({ card });
    const top = all.at(-1);
    if (Number(minXp) <= Number(top.minXp)) throw errors.BAD_THRESHOLD({ level: top.level + 1, minXp, below: top.minXp, above: null });
    const level = top.level + 1;
    if (level > 200) throw errors.LADDER_FULL();
    await this.sequelize.query(
      `INSERT INTO vip_level_names (level, name, min_xp, card, enabled, updated_by, updated_at)
       VALUES (:level, :name, :minXp, :card, TRUE, :by, NOW())`,
      { replacements: { level, name, minXp, card, by: staff?.id ?? null } }
    );
    clearVipBranding();
    return { level, name, minXp, card, enabled: true, custom: true };
  }

  async setEnabled({ staff, level, enabled }) {
    const ladder = await resolveVipLadder(this.models, { logger: this.logger });
    const all = await this.#allLevels(ladder);
    const target = all.find((b) => b.level === level);
    if (!target) throw errors.UNKNOWN_LEVEL({ level });
    if (enabled) this.#assertFits(all, level, target.minXp);
    else if (all.filter((b) => b.enabled && b.level !== level).length === 0) throw errors.LAST_LEVEL();
    await this.sequelize.query(
      `INSERT INTO vip_level_names (level, name, enabled, updated_by, updated_at)
       VALUES (:level, :name, :enabled, :by, NOW())
       ON CONFLICT (level) DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      { replacements: { level, name: target.name, enabled, by: staff?.id ?? null } }
    );
    clearVipBranding();
    return { level, enabled };
  }

  async removeLevel({ level }) {
    const ladder = await resolveVipLadder(this.models, { logger: this.logger });
    const target = (await this.#allLevels(ladder)).find((b) => b.level === level);
    if (!target) throw errors.UNKNOWN_LEVEL({ level });
    if (!target.custom) throw errors.BUILT_IN_LEVEL({ level });
    await this.sequelize.query('DELETE FROM vip_level_names WHERE level = :level', { replacements: { level } });
    clearVipBranding();
    return { level, deleted: true };
  }

  async rename({ staff, level, name, minXp }) {
    const ladder = await resolveVipLadder(this.models, { logger: this.logger });
    const all = await this.#allLevels(ladder);
    const target = all.find((b) => b.level === level);
    if (level !== 0 && !target) throw errors.UNKNOWN_LEVEL({ level });
    if (minXp === null && target?.custom) throw errors.BAD_THRESHOLD({ level, minXp });
    if (minXp != null) {
      // Level 0 has no threshold.
      if (level === 0) throw errors.BAD_THRESHOLD({ level, minXp, below: null, above: null });
      this.#assertFits(all, level, minXp);
    }
    const setXp = minXp !== undefined;
    await this.sequelize.query(
      `INSERT INTO vip_level_names (level, name, ${setXp ? 'min_xp, ' : ''}updated_by, updated_at)
       VALUES (:level, :name, ${setXp ? ':minXp, ' : ''}:by, NOW())
       ON CONFLICT (level) DO UPDATE SET name = EXCLUDED.name, ${setXp ? 'min_xp = EXCLUDED.min_xp, ' : ''}
         updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      { replacements: { level, name, minXp: minXp ?? null, by: staff?.id ?? null } }
    );
    clearVipBranding();
    return { level, name, ...(setXp ? { minXp } : {}) };
  }

  /** Every perk for staff; `pays` marks the ones that also decide a payout (user-service vip.service.js). */
  async listPerks() {
    const rows = await this.#select('SELECT id, key, label, enabled, cards FROM vip_perks ORDER BY sort, id');
    return rows.map((r) => ({ ...r, pays: PAYING_PERKS.has(r.key) }));
  }

  /** What the player VIP page draws: perks that are on. */
  async publicPerks() {
    const rows = await this.#select('SELECT label, cards FROM vip_perks WHERE enabled ORDER BY sort, id');
    return { perks: rows };
  }

  async addPerk({ staff, label }) {
    const [row] = await this.#select(
      `INSERT INTO vip_perks (label, sort, updated_by)
       VALUES (:label, (SELECT COALESCE(MAX(sort), 0) + 1 FROM vip_perks), :by)
       RETURNING id, key, label, enabled, cards`,
      { label, by: staff?.id ?? null }
    );
    return { ...row, pays: false };
  }

  async setPerk({ staff, id, enabled, cards }) {
    const [row] = await this.#select(
      `UPDATE vip_perks SET enabled = COALESCE(:enabled, enabled), cards = COALESCE(:cards::jsonb, cards), updated_by = :by, updated_at = NOW()
       WHERE id = :id RETURNING id, key, label, enabled, cards`,
      { id, enabled: enabled ?? null, cards: cards ? JSON.stringify(cards) : null, by: staff?.id ?? null }
    );
    if (!row) throw errors.PERK_NOT_FOUND({ id });
    return { ...row, pays: PAYING_PERKS.has(row.key) };
  }

  async removePerk({ id }) {
    const rows = await this.#select('DELETE FROM vip_perks WHERE id = :id RETURNING id', { id });
    if (!rows.length) throw errors.PERK_NOT_FOUND({ id });
    return { id, deleted: true };
  }

  async setBadge({ staff, card, file }) {
    const image = imageUpload.inspect(file, errors, { maxBytes: MAX_BADGE_BYTES });
    const version = versionOf(image.data);
    await this.sequelize.query(
      `INSERT INTO vip_badges (card, image_data, content_type, byte_size, version, updated_by, updated_at)
       VALUES (:card, :data, :type, :size, :version, :by, NOW())
       ON CONFLICT (card) DO UPDATE SET image_data = EXCLUDED.image_data, content_type = EXCLUDED.content_type,
         byte_size = EXCLUDED.byte_size, version = EXCLUDED.version, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      { replacements: { card, data: image.data, type: image.contentType, size: image.byteSize, version, by: staff?.id ?? null } }
    );
    clearVipBranding();
    this.logger?.info({ card, staffId: staff?.id, bytes: image.byteSize }, 'VIP badge uploaded');
    return { card, url: `/api/v1/admin/vip-branding/badges/${card}/image?v=${version}` };
  }

  async removeBadge({ card }) {
    const [, meta] = await this.sequelize.query('DELETE FROM vip_badges WHERE card = :card', { replacements: { card } });
    if (!(meta?.rowCount ?? meta)) throw errors.NOT_FOUND({ card });
    clearVipBranding();
    return { card, deleted: true };
  }

  async imageBytes(card) {
    const [row] = await this.#select('SELECT image_data, content_type, byte_size, version, updated_at FROM vip_badges WHERE card = :card', { card });
    if (!row?.image_data) throw errors.NOT_FOUND({ card });
    return { data: Buffer.from(row.image_data), contentType: row.content_type, byteSize: row.byte_size, version: row.version, updatedAt: row.updated_at };
  }
}

module.exports = { VipBrandingService, MAX_BADGE_BYTES };
