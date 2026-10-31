'use strict';

/**
 * rainbet: a player who switched off "Show Bets Publicly" (userconfig.show_bets_publicly,
 * migration 169) is not named on the public race boards — their row stays, as "Hidden". The
 * viewer always sees their own name. Staff boards are not passed through here.
 */
async function hidePrivateNames(models, board, viewerId) {
  const rows = [...(board?.leaderboard ?? []), ...(board?.winners ?? [])].filter((r) => r?.userId != null);
  const ids = [...new Set(rows.map((r) => String(r.userId)))].filter((id) => id !== String(viewerId ?? ''));
  if (!ids.length) return board;
  const hidden = await models.Userconfig.findAll({ where: { uid: ids, show_bets_publicly: false }, attributes: ['uid'], raw: true }).catch(() => []);
  if (!hidden.length) return board;
  const set = new Set(hidden.map((h) => String(h.uid)));
  const mask = (list) => list?.map((r) => (r?.userId != null && set.has(String(r.userId)) ? { ...r, name: 'Hidden', username: 'Hidden' } : r));
  return { ...board, leaderboard: mask(board.leaderboard), ...(board.winners ? { winners: mask(board.winners) } : {}) };
}

module.exports = { hidePrivateNames };
