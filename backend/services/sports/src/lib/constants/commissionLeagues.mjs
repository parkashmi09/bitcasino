// constants/commissionLeagues.js — mssports core, moved unchanged

var DEFAULT_LEAGUE_KEY = "default";
var DEFAULT_LEAGUE_LABEL = "All other leagues";
var COMMISSION_LEAGUES = {
  // Cricket
  // Cricket's virtual leagues (E-Cricket, T10 XI, T5 XI, Virtual Cricket League) are not offered
  // (lib/constants/hiddenSports.mjs), so Cricket has no league rows of its own.
  4: [],
  // Wrestling — one virtual league.
  69: [
    { key: "wwevirtual", label: "WWE Virtual", patterns: ["wwe virtual"], cid: 8524813, iscc: 2 }
  ]
};
var normaliseLeagueName = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
var leaguesForSport = (sportId) => COMMISSION_LEAGUES[Number(sportId)] || [];
var leagueOptionsForSport = (sportId) => [
  { key: DEFAULT_LEAGUE_KEY, label: DEFAULT_LEAGUE_LABEL, is_default: true },
  ...leaguesForSport(sportId).map(({ key, label }) => ({ key, label, is_default: false }))
];
var isValidLeagueKey = (sportId, leagueKey) => leagueKey === DEFAULT_LEAGUE_KEY || leaguesForSport(sportId).some((l) => l.key === leagueKey);
var leagueKeyFromName = (sportId, leagueName) => {
  const norm = normaliseLeagueName(leagueName);
  if (!norm) return DEFAULT_LEAGUE_KEY;
  for (const league of leaguesForSport(sportId)) {
    if (league.patterns.some((p) => norm.includes(p))) return league.key;
  }
  return DEFAULT_LEAGUE_KEY;
};

export { DEFAULT_LEAGUE_KEY, COMMISSION_LEAGUES, leagueOptionsForSport, isValidLeagueKey, leagueKeyFromName };
