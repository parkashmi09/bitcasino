import { useNavigate, useSearchParams } from 'react-router-dom';
import { SportTabs, LatestEventsStrip, InPlayList, RaceBoard, SkeletonMatchList } from '../../../components/exchange';
import { useSportsList, useLatestEvents, useSportsTree } from '../../../hooks/exchange';
import { treeWithoutDead, useDeadMatchesVersion, withoutDeadMatches } from '../../../services/exchange/deadMatches';
import ExchangeFrame from '../ExchangeFrame';
import { LOBBY_SPORTS, INPLAY_TAB, RACING_SIDS, matchPath, racingSports, sportIconOf, splitBoard } from '../model';

/* In-Play first (BetBy's own order puts Live ahead of the sports), then every sport. The
   In-Play pill has no glyph: SportTabs draws sport art only, and the asset set has no "live"
   sport — BetBy's live mark is chrome (`ic-live`), which the row's own in-play mark already uses. */
const INPLAY = { id: INPLAY_TAB, label: 'In-Play' };
const DEFAULT_TAB = 'cricket';

/* The three fixed boards keep their old `?sport=` ids (cricket / soccer / tennis) and labels, so
   existing links still land; any other sport's id is its name as a slug ("Ice Hockey" →
   "ice-hockey"), falling back to its sid. */
const FIXED_BY_SID = new Map(LOBBY_SPORTS.map((s) => [s.sid, s]));
const slug = (name) =>
  String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
const list = (v) => (Array.isArray(v) ? v : []);

/* The pills after In-Play: every sport of the shared sports tree (the same read, and the same
   "has matches" rule, as the sidebar's Sports group) in the feed's order. Until the tree answers
   — or if it fails — the three fixed boards stand in, so the row is never empty. Racing (the
   tree's `racing` list) slots in after the first three, as the feed orders it. */
function sportTabsOf(tree) {
  const plain = list(tree?.sports).filter((s) => list(s.children).length > 0 && s.etid != null);
  const sports = [...plain.slice(0, 3), ...racingSports(tree?.racing), ...plain.slice(3)];
  if (sports.length === 0) return LOBBY_SPORTS.map((s) => ({ ...s, fallback: true }));
  const seen = new Set();
  const tabs = [];
  for (const s of sports) {
    const sid = Number(s.etid);
    const fixed = FIXED_BY_SID.get(sid);
    let id = fixed?.id ?? (slug(s.name) || String(sid));
    if (seen.has(id)) id = `${id}-${sid}`;
    if (seen.has(id)) continue;
    seen.add(id);
    tabs.push({
      id,
      sid,
      label: fixed?.label ?? s.name,
      icon: fixed?.icon ?? sportIconOf(sid, s.name),
      fallback: true,
    });
  }
  return tabs;
}

/* The muted box InPlayList itself draws for an empty list, reused for the two states it has no
   arm for (first read in flight, read failed). */
const Notice = ({ children }) => (
  <div className="flex min-h-24 items-center justify-center rounded-xl bg-layer3 px-4 py-8 text-center text-sm text-tertiary">
    {children}
  </div>
);

/**
 * `/sports` — the exchange lobby. Sport pills (In-Play, then every sport of the shared sports
 * tree that has matches, kept in `?sport=` so Back returns to the same board), the latest-events strip, and the board grouped by
 * competition from `useSportsList(sid)` (5s). The sports tree (sport → competition → match) is the main sidebar's Sports group
 * (layouts/MainLayout/Sidebar/SportsMenu.jsx), so this page no longer draws a column of its own.
 *
 * A row opens `/sports/match/:sid/:gmid`; a price opens the same page with
 * `?market=<mid>&runner=<section sid>&side=back|lay` so the match page can preselect it.
 */
export default function ExchangeLobby() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  /* Matches whose page answered "no longer available" (provider 404) are dropped from every list
     here — the feed keeps listing them for a while (services/exchange/deadMatches.js). */
  useDeadMatchesVersion();
  const { data: rawTree, error: treeError } = useSportsTree();
  const tree = treeWithoutDead(rawTree);
  const sportTabs = sportTabsOf(tree);
  /* The default board keeps its pill even on a day the tree lists no match for it. */
  if (!sportTabs.some((t) => t.id === DEFAULT_TAB)) sportTabs.unshift({ ...FIXED_BY_SID.get(4), fallback: true });
  const tabs = [INPLAY, ...sportTabs];

  const asked = params.get('sport');
  /* A `?sport=` the tree has not confirmed yet (first read in flight) is held, not thrown away,
     so a reload on /sports?sport=politics does not flash the cricket board. */
  const treePending = tree === undefined && !treeError;
  const known = tabs.some((t) => t.id === asked);
  const holding = Boolean(asked) && !known && treePending;
  const tab = known ? asked : holding ? asked : DEFAULT_TAB;
  const setTab = (id) => setParams(id === DEFAULT_TAB ? {} : { sport: id }, { replace: true });
  const all = tab === INPLAY_TAB;
  const current = sportTabs.find((t) => t.id === tab) ?? null;

  /* One poll per board, and only the boards on screen: the In-Play view needs the three fixed
     boards, a sport view only its own (a null sid disables the hook). Explicit calls — hooks
     cannot sit in a loop; any sport beyond the three goes through the fourth, by its sid. */
  const cricket = useSportsList(all || tab === 'cricket' ? 4 : null);
  const soccer = useSportsList(all || tab === 'soccer' ? 1 : null);
  const tennis = useSportsList(all || tab === 'tennis' ? 2 : null);
  /* Racing boards come from the tree itself (its races, not a sport list), so they poll nothing. */
  const racing = current && RACING_SIDS.has(current.sid) ? racingSports(tree?.racing).find((s) => s.etid === current.sid) : null;
  const otherSid = current && !FIXED_BY_SID.has(current.sid) && !RACING_SIDS.has(current.sid) ? current.sid : null;
  const other = useSportsList(otherSid);
  const boards = { cricket, soccer, tennis };

  const views = LOBBY_SPORTS.map((s) => ({ ...s, board: boards[s.id], rows: splitBoard(withoutDeadMatches(boards[s.id].data?.events), s.sid) }));
  const otherView = otherSid != null ? { ...current, board: other, rows: splitBoard(withoutDeadMatches(other.data?.events), otherSid) } : null;
  const byId = new Map();
  for (const v of otherView ? [...views, otherView] : views) for (const m of [...v.rows.live, ...v.rows.upcoming]) byId.set(m.id, m);

  const linkFor = (m) => matchPath(m.sid, m.gmid);
  const onSelect = (sel) => {
    const m = byId.get(String(sel.matchId));
    if (!m) return;
    navigate(matchPath(m.sid, m.gmid, { market: m.marketId, runner: m.runners[sel.outcome], side: sel.side }));
  };

  const { data: latest } = useLatestEvents();
  const latestEvents = (withoutDeadMatches(Array.isArray(latest) ? latest : []) ?? []).slice(0, 20).map((e) => ({
    id: String(e.id),
    name: e.name,
    sportId: e.sportId,
    sport: sportIconOf(e.sportId),
    inPlay: Boolean(byId.get(String(e.id))?.inPlay),
  }));

  const listProps = { linkFor, onSelect };

  let body;
  if (all) {
    const pending = views.filter((v) => v.board.data === undefined);
    const live = views.flatMap((v) => v.rows.live);
    body =
      live.length === 0 && pending.length > 0 ? (
        pending.every((v) => v.board.error) ? (
          <Notice>Matches could not be loaded. Retrying…</Notice>
        ) : (
          <SkeletonMatchList rows={6} />
        )
      ) : (
        <InPlayList
          title="In-Play"
          matches={live}
          empty={<Notice>No matches are in play right now.</Notice>}
          {...listProps}
        />
      );
  } else if (racing || (current && RACING_SIDS.has(current.sid))) {
    body = racing?.children.length ? (
      <RaceBoard sport={racing} icon={current.icon} linkFor={(r) => matchPath(r.etid, r.gmid)} />
    ) : (
      <Notice>No {current.label.toLowerCase()} right now.</Notice>
    );
  } else if (holding) {
    body = <SkeletonMatchList rows={6} />;
  } else {
    const view = otherView ?? views.find((v) => v.id === tab);
    const { live, upcoming } = view.rows;
    body =
      view.board.data === undefined ? (
        view.board.error ? (
          <Notice>Matches could not be loaded. Retrying…</Notice>
        ) : (
          <SkeletonMatchList rows={6} />
        )
      ) : live.length + upcoming.length === 0 ? (
        <Notice>No {view.label.toLowerCase()} matches right now.</Notice>
      ) : (
        <>
          {live.length > 0 && <InPlayList title="In-Play" matches={live} {...listProps} />}
          {upcoming.length > 0 && <InPlayList title="Upcoming" matches={upcoming} {...listProps} />}
        </>
      );
  }

  return (
    <ExchangeFrame>
      <div className="mt-4 flex gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <LatestEventsStrip events={latestEvents} linkFor={(e) => matchPath(e.sportId, e.id)} />
          <SportTabs sports={tabs} active={tab} onChange={setTab} />
          {body}
        </div>
      </div>
    </ExchangeFrame>
  );
}
