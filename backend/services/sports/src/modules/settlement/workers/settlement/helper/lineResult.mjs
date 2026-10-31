// helper/lineResult.js — mssports settlement worker, moved unchanged

var LINE_RE = /^(1st|2nd)\s+innings\s+(\d+)\s+overs?\s+line$/i;
var TEAM_TOTAL_RE = /^(\d+)\s+OVER\s+RUN\s+(.+?)(?:\s+ADV)?$/i;
var INNINGS_OVER_RE = /^(1ST|2ND)\s+INN\s+(\d+)\s+OVER\b/i;
var MULTI_INNINGS_RE = /\b(3RD|4TH)\s+INN/;
var ODDEVEN_RE = /^(1ST|2ND)\s+INN\s+(\d+)\s+OVER\s+RUN\s+ODD\s+EVEN$/i;
var norm = (s) => String(s || "").trim().replace(/\s+/g, " ").toUpperCase();
var inningsNo = (s) => /^1/.test(s) ? 1 : 2;
function parseLineMarket(marketType) {
  const m = LINE_RE.exec(String(marketType || "").trim());
  return m ? { innings: inningsNo(m[1]), overs: Number(m[2]) } : null;
}
function teamTotals(markets) {
  const out = /* @__PURE__ */ new Map();
  for (const m of markets) {
    if (norm(m?.gtype) !== "FANCY") continue;
    const name = norm(m?.marketName);
    if (name.includes("BHAV")) continue;
    const t = TEAM_TOTAL_RE.exec(name);
    if (!t) continue;
    const overs = Number(t[1]);
    const team = t[2].replace(/[.:\-]+$/, "").trim();
    if (/\s2$/.test(team)) continue;
    if (!out.has(overs)) out.set(overs, /* @__PURE__ */ new Map());
    const byTeam = out.get(overs);
    const runs = m?.status === "SETTLE" ? Number(m?.winnerId) : null;
    const prev = byTeam.get(team);
    if (prev && prev.runs !== runs) byTeam.set(team, { status: "CONFLICT", runs: null });
    else byTeam.set(team, { status: m?.status, runs });
  }
  return out;
}
function inningsEvidence(markets) {
  const ev = { 1: /* @__PURE__ */ new Map(), 2: /* @__PURE__ */ new Map() };
  const add = (inn, overs, fn) => {
    if (!ev[inn].has(overs)) ev[inn].set(overs, []);
    ev[inn].get(overs).push(fn);
  };
  for (const m of markets) {
    if (m?.status !== "SETTLE") continue;
    const g = norm(m?.gtype);
    if (g === "CRICKETCASINO") {
      const c = INNINGS_OVER_RE.exec(norm(m?.mname));
      const d = /^(\d)\s+NUMBER$/.exec(norm(m?.winnerName));
      if (c && d) add(inningsNo(c[1]), Number(c[2]), (runs) => runs % 10 === Number(d[1]));
    } else if (g === "ODDEVEN") {
      const o = ODDEVEN_RE.exec(norm(m?.marketName));
      const w = Number(m?.winnerId);
      if (o && (w === 1 || w === 2)) add(inningsNo(o[1]), Number(o[2]), (runs) => runs % 2 === 1 === (w === 1));
    }
  }
  return ev;
}
function score(inn, team, totals, ev) {
  let checked = 0, miss = 0;
  for (const [overs, checks] of ev[inn]) {
    const mine = totals.get(overs)?.get(team);
    if (!mine || mine.status !== "SETTLE" || !Number.isFinite(mine.runs)) continue;
    for (const check of checks) {
      checked++;
      if (!check(mine.runs)) miss++;
    }
  }
  return { checked, miss };
}
var MIN_CLUES = 2;
function battingOrder(markets) {
  if (markets.some((m) => MULTI_INNINGS_RE.test(norm(m?.mname)) || MULTI_INNINGS_RE.test(norm(m?.marketName)))) return null;
  const totals = teamTotals(markets);
  const teams = /* @__PURE__ */ new Set();
  for (const byTeam of totals.values()) for (const t of byTeam.keys()) teams.add(t);
  if (teams.size < 1 || teams.size > 2) return null;
  const ev = inningsEvidence(markets);
  const order = { 1: null, 2: null, totals };
  for (const team of teams) {
    const s1 = score(1, team, totals, ev);
    const s2 = score(2, team, totals, ev);
    const is1 = s1.checked >= MIN_CLUES && s1.miss === 0 && s2.miss > 0;
    const is2 = s2.checked >= MIN_CLUES && s2.miss === 0 && s1.miss > 0;
    if (is1 && is2) return null;
    const inn = is1 ? 1 : is2 ? 2 : null;
    if (!inn) continue;
    if (order[inn]) return null;
    order[inn] = team;
  }
  if (teams.size === 2 && (order[1] ? !order[2] : order[2])) {
    const known = order[1] ? 1 : 2;
    const inn = known === 1 ? 2 : 1;
    const other = [...teams].find((t) => t !== order[known]);
    if (score(inn, other, totals, ev).miss === 0) order[inn] = other;
  }
  return order[1] || order[2] ? order : null;
}
function resolveLineMarketFromFeed(markets, marketType) {
  const line = parseLineMarket(marketType);
  if (!line || !Array.isArray(markets)) return null;
  const order = battingOrder(markets);
  if (!order) return null;
  const team = order[line.innings];
  if (!team) return null;
  const row = order.totals.get(line.overs)?.get(team);
  if (!row) return null;
  const derived = `${line.overs} OVER RUN ${team}`;
  if (row.status === "VOID") {
    return { gtype: "LINE", mname: marketType, marketName: "TOTAL RUNS", status: "VOID", winnerId: null, winnerName: null, derivedFrom: derived };
  }
  if (row.status !== "SETTLE" || !Number.isFinite(row.runs)) return null;
  return { gtype: "LINE", mname: marketType, marketName: "TOTAL RUNS", status: "SETTLE", winnerId: row.runs, winnerName: null, derivedFrom: derived };
}

export { resolveLineMarketFromFeed };
