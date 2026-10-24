'use strict';

const crypto = require('node:crypto');
const { QueryTypes } = require('sequelize');
const { imageUpload, resolveVipLadder, clearVipBranding, VIP_LADDERS } = require('@ibitplay/common');

const errors = require('./vipBranding.errors');

const MAX_BADGE_BYTES = 1024 * 1024;
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

  /** Staff view: every level with its current and built-in name, and every card's badge. */
  async view() {
    clearVipBranding();
    const ladder = await resolveVipLadder(this.models, { logger: this.logger });
    const builtIn = VIP_LADDERS[ladder.key] ?? ladder;
    const defaults = new Map([[0, builtIn.unranked.name], ...builtIn.levels.map((b) => [b.level, b.name])]);
    const levels = [ladder.unranked, ...ladder.levels].map((b) => ({
      level: b.level,
      name: b.name,
      defaultName: defaults.get(b.level) ?? b.name,
      card: b.card,
      minXp: b.minXp == null ? null : String(b.minXp),
    }));
    const cards = [...new Set(levels.map((l) => l.card))];
    const badgeOf = new Map([ladder.unranked, ...ladder.levels].map((b) => [b.card, b.badgeUrl ?? null]));
    return { ladder: ladder.key, levels, badges: cards.map((card) => ({ card, url: badgeOf.get(card) ?? null })) };
  }

  async rename({ staff, level, name, minXp }) {
    const ladder = await resolveVipLadder(this.models, { logger: this.logger });
    if (level !== 0 && !ladder.levels.some((b) => b.level === level)) throw errors.UNKNOWN_LEVEL({ level });
    if (minXp != null) {
      // Level 0 has no threshold, and a threshold must sit between its neighbours' or the ladder breaks.
      const index = ladder.levels.findIndex((b) => b.level === level);
      const below = ladder.levels[index - 1];
      const above = ladder.levels[index + 1];
      if (level === 0 || (below && Number(minXp) <= Number(below.minXp)) || (above && Number(minXp) >= Number(above.minXp))) {
        throw errors.BAD_THRESHOLD({ level, minXp, below: below?.minXp ?? null, above: above?.minXp ?? null });
      }
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
