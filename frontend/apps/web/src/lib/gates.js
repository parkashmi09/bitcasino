/**
 * What this site has switched on, and what THIS player's account may use —
 * hash-game-exchange's `services/gates.js`, mapped onto this app's routes.
 * Pure: no React here; the provider is `hooks/useGates.jsx`.
 *
 * THREE SOURCES, each masked on the backend before it gets here:
 *
 *   GET /admin/site-config/public  {bonus: true, vipclub: false, …}  the site admin's flags; absent key = on
 *   GET /admin/features/public     [{feature: "swap", variant}, …]  the OWNER's plan; listed = on
 *   GET /user/auth/me → capabilities {promotions, vault, deposit, …}  false for a player in an agent's tree
 *
 * A gate is ON when every source it names says so. A read that has not
 * answered, or failed, counts as on (fail open): a backend hiccup must never
 * blank the site, and every route still refuses for itself.
 */

/**
 * gate → what switches it. `flag` is a site-config key, `feature` an owner
 * catalogue key, `capability` the player's. Same names as hash where the
 * section is the same one.
 */
export const GATES = {
  // `rail`: the owner's cashier policy. Deposit stays open on a manual-only site when manual is allowed.
  deposit: { capability: 'deposit', rail: ['deposit_mode', 'automatic'], orManual: true },
  buy: { capability: 'deposit' },
  withdraw: { capability: 'withdraw', rail: ['withdrawal_mode', 'manual'] },
  swap: { feature: 'swap', capability: 'swap' },
  vault: { feature: 'vault', capability: 'vault' },
  bonus: { flag: 'bonus', feature: 'bonus', capability: 'promotions' },
  vip: { flag: 'vipclub', feature: 'vip', capability: 'promotions' },
  affiliate: { flag: 'affiliate', feature: 'affiliate', capability: 'promotions' },
  promotions: { feature: 'promotions', capability: 'promotions' },
  // League and tournaments are the backend's wager races.
  contest: { feature: 'races', capability: 'promotions' },
  // Spin the wheel: the site admin's `wheelspin` flag (hash has no wheel surface).
  wheel: { flag: 'wheelspin', capability: 'promotions' },
  quests: { feature: 'challenges', capability: 'promotions' },
  rewards: { capability: 'promotions' },
  casino: { flag: 'casino' },
  notifications: { feature: 'notifications' },
  kyc: { feature: 'kyc', notAgentPlayer: true },
  originals: { flag: 'originals' },
  blog: { feature: 'blog', notAgentPlayer: true },
  // This site has no sports surface: an admin link into one (a hash-shaped banner CTA) is always off.
  sports: { off: true },
};

/** Path prefix → gate, most specific first. History routes stay readable for everyone. */
export const ROUTES = [
  ['/promotions/league-of-bitcasino', 'contest'],
  ['/promotions/league', 'contest'],
  ['/promotions/spin-the-wheel', 'wheel'],
  ['/promotions/weekly-rakeback', 'rewards'],
  ['/promotions/weekly-rakeback-2026', 'rewards'],
  ['/promotions', 'promotions'],
  ['/tournaments', 'contest'],
  ['/vip', 'vip'],
  ['/loyalty', 'vip'],
  ['/profile/loyalty', 'vip'],
  ['/profile/refer-a-friend', 'affiliate'],
  ['/ref', 'affiliate'],
  ['/profile/rewards', 'rewards'],
  ['/profile/boosts', 'bonus'],
  ['/profile/notifications', 'notifications'],
  ['/blog', 'blog'],
  ['/categories/originals', 'originals'],
  // hash-shaped paths the shared admin's banners link to; App.jsx redirects them.
  ['/vip-detail', 'vip'],
  ['/deposit-offer', 'bonus'],
  ['/affiliates', 'affiliate'],
  ['/sports', 'sports'],
];

/** The section an href belongs to, if any (`/vip?x=1` → vip). */
export function gateOf(href) {
  const path = String(href ?? '').split(/[?#]/)[0];
  return ROUTES.find(([p]) => path === p || path.startsWith(`${p}/`))?.[1] ?? null;
}

/* On a B2B site (`business_model: b2b`, agents only) every promotion section is off for everyone,
   as the backend refuses them (PROMOTIONS_DISABLED_B2B). */
const PROMO_GATES = new Set(['bonus', 'vip', 'affiliate', 'promotions', 'contest', 'wheel', 'quests', 'rewards']);

/* The owner's policies when the site never chose one — backend sitePolicy.js POLICY_DEFAULTS. */
const POLICY_DEFAULTS = { business_model: 'hybrid', deposit_mode: 'both', withdrawal_mode: 'both', theme_mode: 'dark_only' };

const railOpen = (mode, channel) => mode === 'both' || mode === channel;

/**
 * The gate functions for one set of reads. `flags`/`features`/`capabilities`
 * may each be missing (not answered, failed, signed out): what it would
 * switch reads as on.
 *
 * @param {{flags?: object|null, features?: Array|null, capabilities?: object|null, ready?: boolean}} reads
 */
export function makeGates({ flags, features, capabilities, ready = true } = {}) {
  const list = Array.isArray(features) ? features : null;
  const byKey = new Map((list ?? []).map((f) => [f.feature, f]));
  const flagMap = flags && typeof flags === 'object' ? flags : null;

  const can = (cap) => capabilities?.[cap] !== false;
  const policy = (key) => byKey.get(key)?.variant ?? POLICY_DEFAULTS[key];
  // `vault` and `deposit` are switched off together for nobody but an agent's player (backend agentPlayers.js).
  const agentPlayer = capabilities?.vault === false && capabilities?.deposit === false;
  const manualOpen = () => railOpen(policy('deposit_mode'), 'manual') && capabilities?.manualDeposit !== false;
  const blocked = (gate) => {
    const g = GATES[gate];
    if (!g) return null;
    if (g.off) return 'site';
    if (g.flag && flagMap?.[g.flag] === false) return 'site';
    if (g.feature && list && !byKey.has(g.feature)) return 'site';
    if (g.rail && !railOpen(policy(g.rail[0]), g.rail[1]) && !(g.orManual && manualOpen())) return 'site';
    if (PROMO_GATES.has(gate) && policy('business_model') === 'b2b') return 'site';
    if (g.notAgentPlayer && agentPlayer) return 'account';
    if (g.capability && !can(g.capability)) return 'account';
    return null;
  };
  const on = (gate) => blocked(gate) === null;

  return {
    ready,
    on,
    blocked,
    can,
    /** False only for a link into a switched-off section. */
    routeOn: (href) => {
      const gate = gateOf(href);
      return !gate || on(gate);
    },
    policy,
    /** The owner's light/dark rule: `dark_only` (always dark, no toggle) or `switch`; null until the plan answers. */
    themeMode: () => (list ? policy('theme_mode') : null),
    /** The manual (bank transfer) deposit may show. */
    manualDeposit: () => on('deposit') && can('deposit') && manualOpen(),
    /** The gateway (crypto address) deposit may show. */
    autoDeposit: () => on('deposit') && can('deposit') && railOpen(policy('deposit_mode'), 'automatic'),
    /** One site-admin flag; absent / not answered = on. */
    flag: (key) => flagMap?.[key] !== false,
    agentPlayer,
    /** Public self-registration: off on a B2B (agent-only) site. */
    canSignUp: () => policy('business_model') !== 'b2b',
  };
}

export const ALL_ON = makeGates();
