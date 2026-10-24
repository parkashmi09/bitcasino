// Sports and leagues this site does not offer. Removed from every feed the sports service hands
// out (the tree behind admin Events and the player sidebar, each sport's event list) and refused
// at bet placement, so they cannot be reached even by a hand-written request.
//
//   40  Politics
//   11  E Games
//   Cricket's virtual leagues: Virtual Cricket League (cid 8590658), E-Cricket / Dim Cricket League
//   (7526679), T10 XI (56100513), T5 XI (46201121)

var HIDDEN_SPORT_IDS = new Set(["40", "11"]);
var HIDDEN_LEAGUE_IDS = new Set(["8590658", "7526679", "56100513", "46201121"]);
var HIDDEN_LEAGUE_NAME = /virtual\s*cricket|dim\s*cricket|e-?cricket|\bt10\s*xi\b|\bt5\s*xi\b/i;

var isHiddenSport = (sid) => sid != null && HIDDEN_SPORT_IDS.has(String(sid));

var isHiddenLeague = (cid, name) =>
  (cid != null && HIDDEN_LEAGUE_IDS.has(String(cid))) || HIDDEN_LEAGUE_NAME.test(String(name || ""));

/** One sport node of the tree: dropped whole, or with its hidden leagues taken out. */
var cleanSportNode = (sport) => {
  if (!sport || isHiddenSport(sport.etid)) return null;
  if (!Array.isArray(sport.children)) return sport;
  return { ...sport, children: sport.children.filter((league) => !isHiddenLeague(league?.cid, league?.name)) };
};

var cleanSportNodes = (list) => (Array.isArray(list) ? list.map(cleanSportNode).filter(Boolean) : list);

/**
 * The provider's tree answer, any of its wrappings (`{data:{data:{t1,t2}}}`, `{data:{t1,t2}}`,
 * `{t1,t2}`), returned in the same wrapping with t1 / t2 cleaned. Never mutates the cached copy.
 */
var cleanTree = (tree) => {
  if (!tree || typeof tree !== "object") return tree;
  if (Array.isArray(tree.t1) || Array.isArray(tree.t2)) {
    return { ...tree, t1: cleanSportNodes(tree.t1), t2: cleanSportNodes(tree.t2) };
  }
  if (tree.data && typeof tree.data === "object") return { ...tree, data: cleanTree(tree.data) };
  return tree;
};

/** One sport's event rows (`t1` / `t2` of highlighthomePrivate): rows of hidden leagues removed. */
var cleanEventRows = (rows) => (Array.isArray(rows) ? rows.filter((r) => !isHiddenLeague(r?.cid, r?.cname)) : rows);

export { HIDDEN_SPORT_IDS, isHiddenSport, isHiddenLeague, cleanTree, cleanEventRows };
