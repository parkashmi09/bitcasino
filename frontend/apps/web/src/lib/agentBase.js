/**
 * A player an agent created uses the site under /agent. React Router's `basename` keeps every route
 * and link inside it, so pages stay unprefixed. Decided once at load: crossing the base is a full
 * page load.
 */
export const AGENT_BASE = '/agent';

export const underAgentBase = (pathname = window.location.pathname) =>
  pathname === AGENT_BASE || pathname.startsWith(`${AGENT_BASE}/`);

export const AGENT_SITE = underAgentBase();

/**
 * Sign-up and password recovery do not exist on /agent: these addresses go to the Sign In form, and
 * `App.jsx` does not mount the real pages there at all.
 */
export const AGENT_AUTH_CLOSED = [
  'forgot-password/*',
  'forgot/*',
  'reset-password/*',
  'password-reset/*',
  'recover/*',
  'register/*',
  'signup/*',
  'sign-up/*',
  'login/google/*',
  'ref/*',
  'referal/*',
  'referral/*',
];

/** For a plain `<a>`, which the router's `basename` does not reach. */
export const withBase = (url, inside = AGENT_SITE) =>
  inside ? `${AGENT_BASE}${url === '/' ? '' : url}` : url;

/** The same page on the player's own side of the base, or null when already there. */
export function agentBaseTarget({ pathname, search = '', hash = '' }, agentPlayer) {
  const inside = underAgentBase(pathname);
  if (agentPlayer && !inside) return `${AGENT_BASE}${pathname === '/' ? '' : pathname}${search}${hash}`;
  if (!agentPlayer && inside) return `${pathname.slice(AGENT_BASE.length) || '/'}${search}${hash}`;
  return null;
}
