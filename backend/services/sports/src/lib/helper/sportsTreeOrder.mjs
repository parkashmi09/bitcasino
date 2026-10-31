// helper/sportsTreeOrder.js — mssports core, moved unchanged

var minGmid = (league) => {
  let min = Number.POSITIVE_INFINITY;
  for (const match of league?.children || []) {
    const raw = match?.gmid;
    if (raw == null || raw === "") continue;
    const g = Number(raw);
    if (Number.isFinite(g) && g < min) min = g;
  }
  return min;
};
var sortLeaguesByMinGmid = (children) => {
  if (!Array.isArray(children) || children.length < 2) return children;
  return children.map((league, index) => ({ league, index, key: minGmid(league) })).sort((a, b) => a.key - b.key || a.index - b.index).map((row) => row.league);
};

export { sortLeaguesByMinGmid };
