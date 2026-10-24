// sportsbet/betresult/autoVoid.js — mssports results worker, moved unchanged
import { db_default } from "../../config/db.mjs";
import { getAutoVoidConfig, AutoVoidConfig_default } from "../../models/admin/AutoVoidConfig.mjs";
import { SportsAutoVoidState_default } from "../../models/user/SportsAutoVoidState.mjs";
import { voidOpenMarket } from "../../services/admin/sportsMarketVoidService.mjs";
import { isPerSelectionMarket } from "../../helper/exposureBucket.mjs";
import { VOID_TYPES } from "../../models/admin/BetVoidAudit.mjs";

var ANCHOR_MARKETS = {
  MATCH_ODDS: "on_match_odds",
  BOOKMAKER: "on_bookmaker"
};
var ANCHOR_DONE = /* @__PURE__ */ new Set(["SETTLE", "VOID"]);
var CONFIG_TTL_MS = +(process.env.AUTO_VOID_CONFIG_TTL_MS || 1e4);
function anchorStatuses(markets) {
  const out = {};
  for (const m of Array.isArray(markets) ? markets : []) {
    const name = String(m?.mname || "").trim().toUpperCase();
    if (!(name in ANCHOR_MARKETS)) continue;
    const status = String(m?.status || "").toUpperCase();
    if (!out[name] || ANCHOR_DONE.has(status)) out[name] = status;
  }
  return out;
}
async function ensureAutoVoidTables() {
  await AutoVoidConfig_default.sync();
  await db_default.query("ALTER TABLE auto_void_config ADD COLUMN IF NOT EXISTS enabled_at TIMESTAMPTZ");
  await SportsAutoVoidState_default.sync();
}
function voidDueAt(anchorSeenAt, c) {
  const seen = new Date(anchorSeenAt).getTime();
  const on = c?.enabled_at ? new Date(c.enabled_at).getTime() : 0;
  const delayMs = Math.max(0, Number(c?.delay_seconds) || 0) * 1e3;
  return new Date(Math.max(seen, on) + delayMs);
}
function createAutoVoid({ log: log2 }) {
  let cfg = null;
  let cfgAt = 0;
  async function config() {
    if (cfg && Date.now() - cfgAt < CONFIG_TTL_MS) return cfg;
    cfg = (await getAutoVoidConfig()).get({ plain: true });
    cfgAt = Date.now();
    return cfg;
  }
  function pickAnchor(anchors, c) {
    for (const [mname, flag] of Object.entries(ANCHOR_MARKETS)) {
      if (!c[flag]) continue;
      const status = anchors?.[mname];
      if (status && ANCHOR_DONE.has(status)) return { market: mname, status };
    }
    return null;
  }
  function groupBets(bets) {
    const groups = /* @__PURE__ */ new Map();
    for (const b of bets) {
      const perSel = isPerSelectionMarket(b.market_type);
      const key = [b.match_id, b.market_type, b.game_type, perSel ? b.selection_name : ""].join("|");
      let g = groups.get(key);
      if (!g) {
        g = {
          match_id: b.match_id,
          market_type: b.market_type,
          gametype: b.game_type,
          selection_name: perSel ? b.selection_name : null,
          betIds: []
        };
        groups.set(key, g);
      }
      g.betIds.push(b.id);
    }
    return [...groups.values()];
  }
  async function afterScan(events) {
    let c;
    try {
      c = await config();
    } catch (e) {
      log2.error("[AutoVoid] config read failed", { error: e.message });
      return;
    }
    for (const ev of events.values()) {
      try {
        if (!ev.anchors) continue;
        const anchor = pickAnchor(ev.anchors, c);
        if (!anchor) continue;
        const now = /* @__PURE__ */ new Date();
        let state = await SportsAutoVoidState_default.findOne({ where: { eventid: String(ev.eventid) } });
        if (!state) {
          state = await SportsAutoVoidState_default.create({
            eventid: String(ev.eventid),
            sport_id: ev.sport_id != null ? String(ev.sport_id) : null,
            match_title: ev.match_title || null,
            anchor_market: anchor.market,
            anchor_status: anchor.status,
            anchor_seen_at: now
          });
          log2.info("[AutoVoid] armed", {
            eventid: ev.eventid,
            anchor: anchor.market,
            status: anchor.status,
            enabled: !!c.enabled,
            fireAt: voidDueAt(now, c).toISOString(),
            pending: ev.pending.length
          });
        }
        if (!c.enabled) continue;
        if (now < voidDueAt(state.anchor_seen_at, c)) continue;
        if (!ev.pending.length) continue;
        const elapsed = now - new Date(state.anchor_seen_at);
        const groups = groupBets(ev.pending);
        const seenAt = new Date(state.anchor_seen_at).toISOString();
        const note = `auto void: ${state.anchor_market} ${state.anchor_status} seen ${seenAt}, +${Math.round(elapsed / 1e3)}s`;
        const groupIds = [];
        let betsVoided = 0;
        let lastError = null;
        for (const g of groups) {
          try {
            const r = await voidOpenMarket({
              match_id: g.match_id,
              market_type: g.market_type,
              gametype: g.gametype,
              selection_name: g.selection_name,
              voidType: VOID_TYPES.AUTO_TIMEOUT,
              context: { actor: "auto-void", actor_role: "system" },
              note,
              ledgerSource: "auto_void",
              ledgerLabel: "AUTO VOID"
            });
            groupIds.push(r.voidGroupId);
            betsVoided += r.betsVoided;
            log2.info("[AutoVoid] voided market", {
              eventid: ev.eventid,
              match_id: g.match_id,
              market_type: g.market_type,
              selection: g.selection_name,
              users: r.userIds.length,
              bets: r.betsVoided,
              voidGroupId: r.voidGroupId
            });
          } catch (e) {
            lastError = `${g.market_type}${g.selection_name ? " / " + g.selection_name : ""}: ${e.message}`;
            log2.error("[AutoVoid] void failed", {
              eventid: ev.eventid,
              match_id: g.match_id,
              market_type: g.market_type,
              selection: g.selection_name,
              error: e.message
            });
          }
        }
        await state.update({
          last_fired_at: now,
          fire_count: (state.fire_count || 0) + 1,
          bets_voided: (state.bets_voided || 0) + betsVoided,
          void_group_ids: [...state.void_group_ids || [], ...groupIds],
          last_error: lastError
        });
      } catch (e) {
        log2.error("[AutoVoid] event failed", { eventid: ev.eventid, error: e.message });
      }
    }
  }
  return { afterScan };
}

export { anchorStatuses, ensureAutoVoidTables, createAutoVoid };
