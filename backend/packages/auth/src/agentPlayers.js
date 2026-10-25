'use strict';

const { ForbiddenError } = require('@ibitplay/common');
const { isAgentTree } = require('./permissions');

/**
 * Players who belong to the agent tree.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE RULE
 *
 * A player with ANY owner (`users.parent_staff_id` set — owner, admin, sub admin, super
 * master, master or agent; every one is created through the Sports Exchange Create Account)
 * is a child user, an agent's customer. Their money comes from the
 * agent (staff transfers / refill), not from the site, so on the player site
 * they get the same restrictions the agent tree got in the admin:
 *
 *   promotions  no bonus, redeem codes, gift cards, spin wheel, VIP / rank /
 *               club rewards, affiliate earnings, races or rakeback
 *   vault       no Vault Pro
 *   deposit     no deposit rail at all (fiat, crypto address, PSP, payment
 *               orders, P2P buy)
 *   swap        no wallet swap (quote, balances-for-swap, execute — HTTP and
 *               the SUBMIT_NEW_SWAP socket). Their swap HISTORY stays
 *               readable so records from before the rule remain visible.
 *   withdraw    no withdrawal rail at all (fiat, crypto via the
 *               SUBMIT_NEW_WITHDRAWL socket, payment-order payouts, P2P sell
 *               orders, withdrawal-whitelist writes). Their agent pays them
 *               out. Withdrawal HISTORY stays readable.
 *   tips        no sending peer-to-peer tips (POST /user/tip/send). They can
 *               still receive one, and their tip HISTORY stays readable.
 *   kyc         no KYC submission (POST /user/kyc/submit). KYC is for direct users only:
 *               an agent's player has no withdrawal rail, so nothing of theirs waits on
 *               it, and the admin KYC queue lists direct users only. See docs/KYC.md.
 *
 * With all four money capabilities gone the player site shows no wallet
 * actions at all — only the read-only balance and the transaction history.
 *
 * Only direct signups (`parent_staff_id IS NULL`) are unaffected. (Until 2026-10-17 a player
 * under house staff, levels 1–3, counted as direct; the user ruled every parented player a child.)
 *
 * `AGENT_PLAYER_RESTRICTIONS` below is the ONE place that says which
 * capabilities an agent-tree player loses. Adding one later is one entry here
 * plus a `denyAgentPlayer('<name>')` on the routes — the
 * `capabilities` the player site reads (`/user/auth/me`) follows automatically.
 * ═════════════════════════════════════════════════════════════════════════
 */

/** capability -> the refusal an agent-tree player gets for it. */
const AGENT_PLAYER_RESTRICTIONS = Object.freeze({
  promotions: Object.freeze({
    code: 'PROMOTIONS_NOT_FOR_AGENT_USERS',
    message: 'Promotions are not available for your account',
  }),
  vault: Object.freeze({
    code: 'VAULT_NOT_FOR_AGENT_USERS',
    message: 'The vault is not available for your account',
  }),
  deposit: Object.freeze({
    code: 'DEPOSIT_NOT_FOR_AGENT_USERS',
    message: 'Deposits are not available for your account. Contact your agent to add funds.',
  }),
  swap: Object.freeze({
    code: 'SWAP_NOT_FOR_AGENT_USERS',
    message: 'Swap is not available for your account',
  }),
  withdraw: Object.freeze({
    code: 'WITHDRAW_NOT_FOR_AGENT_USERS',
    message: 'Withdrawals are not available for your account. Contact your agent to cash out.',
  }),
  tips: Object.freeze({
    code: 'TIPS_NOT_FOR_AGENT_USERS',
    message: 'Sending tips is not available for your account',
  }),
  kyc: Object.freeze({
    code: 'KYC_NOT_FOR_AGENT_USERS',
    message: 'Verification is not available for your account',
  }),
  // Username and avatar: the site admin edits an agent player's profile, not the player (user, 2026-10-25).
  profileEdit: Object.freeze({
    code: 'PROFILE_EDIT_NOT_FOR_AGENT_USERS',
    message: 'Your profile is managed by your agent',
  }),
});

/** The capability names the player site is told about, in a stable order. */
const PLAYER_CAPABILITIES = Object.freeze(Object.keys(AGENT_PLAYER_RESTRICTIONS));

/** `{ promotions, vault, deposit, swap, withdraw, tips, kyc, profileEdit }` — true = the player has it. */
function capabilitiesFor(agentTree) {
  const out = {};
  for (const name of PLAYER_CAPABILITIES) out[name] = !agentTree;
  return out;
}

/** Is a staff record (as `resolveStaff` returns it) an agent-tree owner? */
const isAgentTreeOwner = (staff) => Boolean(staff) && isAgentTree(staff);

/** The 403 for a capability. */
function agentPlayerError(capability) {
  const restriction = AGENT_PLAYER_RESTRICTIONS[capability];
  if (!restriction) throw new Error(`Unknown player capability "${capability}"`);
  const error = new ForbiddenError(restriction.message);
  error.code = restriction.code;
  return error;
}

/** A tiny TTL map, bounded so a flood of ids cannot grow it forever. */
function ttlCache(ttlMs, max = 10_000) {
  const map = new Map();
  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return undefined;
      if (hit.expires <= Date.now()) {
        map.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key, value) {
      if (map.size >= max) map.clear();
      map.set(key, { value, expires: Date.now() + ttlMs });
    },
    delete: (key) => map.delete(key),
    clear: () => map.clear(),
  };
}

/**
 * The resolver: "is this player in the agent tree?".
 *
 * One cached read, not per request in steady state:
 *   player -> owner staff id     (`loadOwnerStaffId`, the service's own `users` row)
 *   (`loadStaff` is still required for compatibility but no longer read: any owner = child)
 *
 * A failed read throws, so a guarded route fails closed rather than paying a promotion it could not
 * check.
 */
function createAgentPlayerResolver({
  loadOwnerStaffId,
  loadStaff,
  playerTtlMs = 30_000,
} = {}) {
  if (typeof loadOwnerStaffId !== 'function') throw new Error('createAgentPlayerResolver requires loadOwnerStaffId');
  if (typeof loadStaff !== 'function') throw new Error('createAgentPlayerResolver requires loadStaff');

  const owners = ttlCache(playerTtlMs);

  async function ownerOf(userId) {
    const key = String(userId);
    const cached = owners.get(key);
    if (cached !== undefined) return cached;
    const owner = await loadOwnerStaffId(userId);
    const value = owner === null || owner === undefined || owner === '' ? null : Number(owner);
    owners.set(key, value);
    return value;
  }

  return {
    async isAgentPlayer(userId) {
      if (userId === null || userId === undefined) return false;
      // Koi bhi parent = child user (staff level nahi dekhte).
      return Boolean(await ownerOf(userId));
    },
    async capabilities(userId) {
      return capabilitiesFor(await this.isAgentPlayer(userId));
    },
    /** Forget one player's owner (re-parented) — or everything. */
    invalidate(userId) {
      if (userId === undefined) {
        owners.clear();
      } else owners.delete(String(userId));
    },
  };
}

/**
 * The process-wide resolver, configured once by the service container — the
 * same shape as `configureEntitlements`, so route files, socket handlers and
 * payout code all ask the one cache without threading it through every deps.
 */
let active = null;

/**
 * The owner's business model, read live (`sitePolicy.readPolicy(models, 'business_model')`).
 * On a B2B site — agents only — there are NO promotions for anybody: not for the agent's
 * players and not for a direct player either (one can still exist: created by house staff, or
 * from before the switch). Null (unconfigured) reads as "not b2b".
 */
let loadBusinessModel = null;
/* The last answer, kept 2 s: a sweep asks once per player, and a switch must still take effect
   at once in human terms. */
let modelCache = { value: undefined, at: 0 };
const MODEL_TTL_MS = 2_000;

/** The refusal every player gets for a promotion on a B2B site. */
const PROMOTIONS_B2B = Object.freeze({
  code: 'PROMOTIONS_DISABLED_B2B',
  message: 'Promotions are not offered on this site',
});

function configureAgentPlayers(options) {
  active = options && typeof options.isAgentPlayer === 'function' ? options : createAgentPlayerResolver(options);
  loadBusinessModel = typeof options?.loadBusinessModel === 'function' ? options.loadBusinessModel : null;
  modelCache = { value: undefined, at: 0 };
  return active;
}

function resetAgentPlayers() {
  active = null;
  loadBusinessModel = null;
  modelCache = { value: undefined, at: 0 };
}

/**
 * Is this a B2B site, where promotions are off for everyone?
 *
 * A failed read THROWS: a guarded route then fails closed with the error (as sign-up does on
 * the same read), and `promotionsBlocked` — the payout paths' question — treats it as blocked.
 */
async function siteHasNoPromotions() {
  if (!loadBusinessModel) return false;
  if (modelCache.value === undefined || Date.now() - modelCache.at > MODEL_TTL_MS) {
    modelCache = { value: await loadBusinessModel(), at: Date.now() };
  }
  return modelCache.value === 'b2b';
}

/**
 * May this player be paid or shown a promotion? False on a B2B site (everyone) and for an
 * agent-tree player (any site). The question every award, accrual and settlement asks.
 * Fails closed: a read that cannot answer pays nothing.
 */
async function promotionsBlocked(userId) {
  try {
    if (await siteHasNoPromotions()) return true;
  } catch {
    return true;
  }
  return isAgentPlayer(userId);
}

function promotionsB2bError() {
  const error = new ForbiddenError(PROMOTIONS_B2B.message);
  error.code = PROMOTIONS_B2B.code;
  return error;
}

/**
 * Is this player in the agent tree?
 *
 * Unconfigured (a unit test, a script that never built a container) answers
 * false: every service container configures it, and the money paths it guards
 * are only reachable through one.
 */
async function isAgentPlayer(userId) {
  if (!active) return false;
  return active.isAgentPlayer(userId);
}

async function playerCapabilities(userId) {
  const caps = capabilitiesFor(await isAgentPlayer(userId));
  // A B2B site has no promotions for anybody; a failed read leaves them as the account says
  // (the routes still refuse for themselves).
  if (caps.promotions && (await siteHasNoPromotions().catch(() => false))) caps.promotions = false;
  return caps;
}

/** Throw the 403 when an agent-tree player asks for a capability they lack. */
async function assertPlayerCapability(userId, capability) {
  if (!AGENT_PLAYER_RESTRICTIONS[capability]) throw new Error(`Unknown player capability "${capability}"`);
  if (capability === 'promotions' && (await siteHasNoPromotions())) throw promotionsB2bError();
  if (await isAgentPlayer(userId)) throw agentPlayerError(capability);
}

/**
 * Route guard for the PLAYER audience: `router.use(denyAgentPlayer('promotions'))`.
 *
 * Runs after the loader's `authenticate()` + `requireActive()`. Like
 * `denyAgentTree` on the staff side it is not an authorization mark — it
 * narrows what an already-authenticated player may do.
 */
function denyAgentPlayer(capability) {
  if (!AGENT_PLAYER_RESTRICTIONS[capability]) throw new Error(`Unknown player capability "${capability}"`);
  return async function denyAgentPlayerMiddleware(req, _res, next) {
    try {
      if (!req.user) return next();
      await assertPlayerCapability(req.user.id, capability);
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  AGENT_PLAYER_RESTRICTIONS,
  PLAYER_CAPABILITIES,
  capabilitiesFor,
  isAgentTreeOwner,
  agentPlayerError,
  createAgentPlayerResolver,
  configureAgentPlayers,
  resetAgentPlayers,
  PROMOTIONS_B2B,
  siteHasNoPromotions,
  promotionsBlocked,
  isAgentPlayer,
  playerCapabilities,
  assertPlayerCapability,
  denyAgentPlayer,
};
