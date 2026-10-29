'use strict';

const { resolveVipLadder } = require('@ibitplay/common');

/**
 * rainbet: several players' VIP standing at once — `Map<id, { card, badgeUrl }>` from one ladder
 * read and one `userwager` query (the same reading as the public profile). For lists that show a
 * medal per player: chat lines, raffle winners. A failure answers an empty map: no medals, never
 * a failed list.
 */
async function vipCardsFor(deps, userIds) {
  const ids = [...new Set(userIds.map(String))];
  if (!ids.length) return new Map();
  try {
    const [ladder, rows] = await Promise.all([
      resolveVipLadder(deps.models, { logger: deps.logger }),
      deps.models.Userwager.findAll({ where: { uid: ids }, attributes: ['uid', 'wager'], raw: true }),
    ]);
    const wagers = new Map(rows.map((r) => [String(r.uid), r.wager]));
    return new Map(
      ids.map((id) => {
        const cleaned = String(wagers.get(id) ?? '0').replace(/,/g, '').trim();
        const vip = ladder.levelFor(/^-?\d+(\.\d+)?$/.test(cleaned) ? cleaned : '0');
        return [id, { card: vip.card ?? null, badgeUrl: vip.badgeUrl ?? null }];
      })
    );
  } catch (error) {
    deps.logger?.warn({ err: error }, 'VIP medals unavailable');
    return new Map();
  }
}

module.exports = { vipCardsFor };
