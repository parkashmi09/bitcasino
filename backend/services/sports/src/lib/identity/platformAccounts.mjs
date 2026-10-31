// Our platform's accounts, as the mssports code reads them.
//
// mssports was written for TENEXCH, where one JWT_SECRET signed every token and the token carried
// `user_id` / `staff_id` / `owner_id`, and where each of those accounts had a row in its own
// `users` / `staff` / `Owners` table plus a `Wallets` row. Here the tokens are the platform's own
// (packages/auth TokenService: a player access token, or a staff admin token), and the accounts
// live in `public.users` / `public.staff`.
//
// This file is the whole bridge, and the only place the moved mssports code reaches for it:
//
//   decodePlatformToken(token)   verify one of our tokens, return the TENEXCH-shaped payload
//                                { user_id } | { staff_id, role, level } | { owner_id, role: 'OWNER' }
//   verifyPlatformToken(token)   the same, after making sure the account exists in schema mssports
//                                (users / staff / Owners row + its Wallets row), with our account
//                                state mirrored onto it: locked or not active → InActive / !active,
//                                betting or sports locked → bet_locked.
//
// Roles. The platform's Super Admin (level 1) is the mssports OWNER — there is one owner,
// `owner_id` 1. Staff levels 2–6 map one-to-one onto the TENEXCH ladder below the owner:
//   2 Admin → SUPERADMIN (L2)   3 Sub Admin → ADMIN (L3)   4 Super Master → SUPERMASTER (L4)
//   5 Master → MASTER (L5)      6 Agent → AGENT (L6)
// Executives (level 7, read-only support) are refused: mssports would give them their parent's
// full powers.
//
// A new account starts with an empty mssports wallet (cash 0). Funding it is not done here.
// A PLAYER's bets no longer use that wallet: placement and settlement debit and pay public.credits.inr.
import { createRequire } from 'node:module';

import { db_default as sequelize, init_db } from '../config/db.mjs';
import { User_default as MsUser } from '../../models/user/User.mjs';
import { Staff_default as MsStaff } from '../../models/admin/Staff.mjs';
import { Owner_default as MsOwner } from '../../models/admin/Owner.mjs';
import { Role_default as MsRole } from '../../models/admin/Role.mjs';
import { Wallet_default as MsWallet } from '../../models/admin/Wallet.mjs';
import { walletService_default as WalletService } from '../services/walletService.mjs';

init_db();
const require = createRequire(import.meta.url);
const { TokenService, TOKEN_TYPES } = require('@ibitplay/auth');
const config = require('../../config');

export const OWNER_ID = 1;
const OWNER_LEVEL = 1;
const STAFF_ROLES = {
  2: { role: 'SUPERADMIN', level: 'L2' },
  3: { role: 'ADMIN', level: 'L3' },
  4: { role: 'SUPERMASTER', level: 'L4' },
  5: { role: 'MASTER', level: 'L5' },
  6: { role: 'AGENT', level: 'L6' },
};
const USER_ROLE = { role: 'USER', level: 'L7' };

// How long a mirrored account is trusted before our state is read again.
const MIRROR_TTL_MS = 15_000;

let tokens = null;
const tokenService = () => (tokens ??= new TokenService(config));

/** The payload mssports' own `jwt.verify` used to return, from one of our tokens. */
export function decodePlatformToken(token) {
  let accessError;
  try {
    const p = tokenService().verify(token, TOKEN_TYPES.ACCESS);
    return { user_id: Number(p.sub), role: 'USER', session_id: p.sid ?? null, password_change_due: p.pcr === true };
  } catch (error) {
    accessError = error;
  }
  let p;
  try {
    p = tokenService().verify(token, TOKEN_TYPES.ADMIN);
  } catch (adminError) {
    const expired = [accessError, adminError].find((e) => e?.code === 'TOKEN_EXPIRED');
    if (expired) throw Object.assign(new Error('Token expired'), { name: 'TokenExpiredError' });
    throw adminError;
  }
  const level = Number(p.level);
  // An executive LOGIN carries its parent's id (`sub`) and level, so it acts on the parent's tree only;
  // what it may do is its granted platform permissions, checked on each admin route (user, 2026-10-17).
  // A legacy level-7 staff ROW has no such mapping and stays refused.
  if (level >= 7) throw new Error('Executive accounts cannot use the sportsbook');
  // `platform_staff_id`: the platform's own staff id, which the owner mapping (owner_id 1) loses —
  // the transaction-password check in TXN_PASSWORD_MODE=login verifies against that account.
  const ids = { platform_staff_id: Number(p.sub), platform_executive_id: p.executiveId ?? null, tv: Number(p.tv ?? 0) };
  if (level === OWNER_LEVEL) return { owner_id: OWNER_ID, role: 'OWNER', ...ids };
  const mapped = STAFF_ROLES[level];
  if (!mapped) throw new Error(`No sportsbook role for staff level ${p.level}`);
  return { staff_id: Number(p.sub), role: mapped.role, level: mapped.level, ...ids };
}

/** decodePlatformToken, plus the account's mssports rows. */
//
// `refresh: true` re-reads a PLAYER's state now instead of trusting a mirror up to MIRROR_TTL_MS
// old. The auth middleware asks for it on every write (bet placement, cancel…), so a player whose
// account — or, through the suspension cascade's `system_locked`, whose upline — was just
// suspended or locked cannot place a bet in the TTL window. Reads keep the cache.
export async function verifyPlatformToken(token, { refresh = false } = {}) {
  const decoded = decodePlatformToken(token);
  if (decoded.user_id && refresh) fresh.delete(`user:${decoded.user_id}`);
  if (decoded.user_id) {
    if (decoded.password_change_due) throw new Error('Set a new password before doing anything else');
    // rainbet: never from the mirror cache either, so logout ends a player's token here too.
    if (decoded.session_id) {
      const session = await one('SELECT revoked_at FROM public.auth_sessions WHERE id = :id', { id: decoded.session_id });
      if (session?.revoked_at) throw new Error('Session ended — sign in again');
    }
    await ensureUser(decoded.user_id);
    return decoded;
  }
  // Never from the mirror cache: logout / password change bump token_version to end a staff token early.
  const row = await one('SELECT token_version FROM public.staff WHERE id = :id', { id: decoded.platform_staff_id });
  if (!row || Number(row.token_version ?? 0) !== decoded.tv) throw new Error('Session ended — sign in again');
  if (decoded.staff_id) await ensureStaff(decoded.staff_id);
  else await ensureOwner();
  return decoded;
}

// ── mirroring ─────────────────────────────────────────────────────────────

const fresh = new Map(); // key → expiry
const isFresh = (key) => (fresh.get(key) ?? 0) > Date.now();
const markFresh = (key) => fresh.set(key, Date.now() + MIRROR_TTL_MS);

const one = async (sql, replacements) => {
  const [rows] = await sequelize.query(sql, { replacements });
  return rows[0] || null;
};

async function ensureRole({ role, level }) {
  const [row] = await MsRole.findOrCreate({ where: { role }, defaults: { role, level, power: [] } });
  return row.role_id;
}

/** A username free in both the account table and Wallets (unique across every account type). */
async function freeUsername(base, model, pk, id) {
  const clean = String(base || '').trim() || `${pk}_${id}`;
  for (const candidate of [clean, `${clean}_${id}`]) {
    const taken = await model.findOne({ where: { username: candidate }, attributes: [pk], raw: true });
    const wallet = await MsWallet.findOne({ where: { username: candidate }, attributes: ['wallet_id', pk === 'owner_id' ? 'owner_id' : pk], raw: true });
    const ours = (row) => !row || Number(row[pk]) === Number(id);
    if (ours(taken) && ours(wallet)) return candidate;
  }
  return `${clean}_${id}_${Date.now().toString(36)}`;
}

async function ensureWallet(id, type, username) {
  const idField = WalletService.getWalletQueryField(type);
  const existing = await MsWallet.findOne({ where: { [idField]: id, user_type: type } });
  if (existing) return existing;
  return WalletService.createWallet(id, type.toLowerCase(), undefined, username);
}

export async function ensureOwner() {
  const key = 'owner';
  if (isFresh(key)) return OWNER_ID;
  let owner = await MsOwner.findByPk(OWNER_ID);
  if (!owner) {
    const admin = await one(
      `SELECT s.name, s.email FROM public.staff s JOIN public.roles r ON r.id = s.role_id
        WHERE r.level = 1 ORDER BY s.id LIMIT 1`
    );
    owner = await MsOwner.create(ownerRow(OWNER_ID, admin?.name || 'owner', admin?.email));
  }
  await ensureWallet(OWNER_ID, 'OWNER', owner.username);
  markFresh(key);
  return OWNER_ID;
}

/**
 * TENEXCH's `demo_owner`: the owner every demo account (`public.users.is_demo`, the Demo button)
 * sits under, in place of the site's owner — so a demo's P&L and commission never reach it
 * (walletService skips demo users) and no owner report counts it. Made once, on the first demo.
 */
export async function ensureDemoOwner() {
  const key = 'demo-owner';
  if (isFresh(key)) return fresh.get(`${key}:id`);
  let owner = await MsOwner.findOne({ where: { username: 'demo_owner' } });
  if (!owner) {
    // The site's owner first, so id 1 stays its own. Not the id sequence: owner 1 was written by
    // hand, so the sequence may still say 1.
    await ensureOwner();
    const next = await one('SELECT GREATEST(COALESCE(MAX(owner_id), 0), :site) + 1 AS id FROM mssports."Owners"', { site: OWNER_ID });
    owner = await MsOwner.create(ownerRow(Number(next.id), 'demo_owner'));
  }
  await ensureWallet(owner.owner_id, 'OWNER', owner.username);
  fresh.set(`${key}:id`, owner.owner_id);
  markFresh(key);
  return owner.owner_id;
}

/** An mssports `Owners` row. Nobody signs in to mssports directly; the platform's own login issues the token. */
function ownerRow(ownerId, username, email = null) {
  const site = config.OWNER_SITE_KEY || 'site';
  // `domain_name` and `site_email_address` are unique: the demo owner gets its own.
  const domain = ownerId === OWNER_ID ? site : `${username}.${site}`;
  return {
    owner_id: ownerId,
    username,
    website_name: site,
    domain_name: domain,
    website_ui: config.SITE_TEMPLATE || 'default',
    country: 'IN',
    logo: '',
    favicon: '',
    game_providers: [],
    subscription_plan: 'platform',
    platform_configurations: {},
    payment_methods: [],
    site_email_address: email || `owner@${domain}`,
    password: '!',
    platform_name: site,
    role: 'OWNER',
  };
}

/** Mirror one staff account (and its upline first). Returns 'owner' for the Super Admin. */
export async function ensureStaff(staffId) {
  const key = `staff:${staffId}`;
  if (isFresh(key)) return fresh.get(`${key}:kind`);
  const row = await one(
    `SELECT s.id, s.name, s.parent_id, s.status, s.system_locked, s.bet_status, s.sports_betlocked, r.level
       FROM public.staff s JOIN public.roles r ON r.id = s.role_id WHERE s.id = :id`,
    { id: staffId }
  );
  if (!row) throw new Error(`Staff ${staffId} not found`);
  const level = Number(row.level);
  if (level === OWNER_LEVEL) {
    await ensureOwner();
    fresh.set(`${key}:kind`, 'owner');
    markFresh(key);
    return 'owner';
  }
  const mapped = STAFF_ROLES[level];
  if (!mapped) throw new Error(`No sportsbook role for staff level ${row.level}`);

  const ownerId = await ensureOwner();
  const parentKind = row.parent_id ? await ensureStaff(Number(row.parent_id)) : 'owner';
  const roleId = await ensureRole(mapped);
  const state = {
    role_id: roleId,
    role: mapped.role,
    level: mapped.level,
    parent_id: parentKind === 'owner' ? null : Number(row.parent_id),
    parent_owner_id: parentKind === 'owner' ? ownerId : null,
    active: row.status === 'active' && !row.system_locked,
    bet_locked: Boolean(row.sports_betlocked) || (row.bet_status != null && row.bet_status !== 'active'),
  };
  let staff = await MsStaff.findByPk(staffId);
  if (!staff) {
    const username = await freeUsername(row.name, MsStaff, 'staff_id', staffId);
    staff = await MsStaff.create({ staff_id: staffId, username, password: '!', ...state });
  } else {
    await staff.update(state);
  }
  await ensureWallet(staffId, mapped.role, staff.username);
  fresh.set(`${key}:kind`, 'staff');
  markFresh(key);
  return 'staff';
}

/** Mirror one player (and the staff upline it sits under). */
export async function ensureUser(userId) {
  const key = `user:${userId}`;
  if (isFresh(key)) return;
  const row = await one(
    `SELECT id, name, parent_staff_id, status, is_locked, system_locked, bet_status, sports_betlocked, is_demo, demo_expires_at
       FROM public.users WHERE id = :id`,
    { id: userId }
  );
  if (!row) throw new Error(`User ${userId} not found`);
  // A demo account sits under TENEXCH's demo owner, not the site's (ensureDemoOwner).
  const ownerId = row.is_demo ? await ensureDemoOwner() : await ensureOwner();
  const parentKind = row.parent_staff_id ? await ensureStaff(Number(row.parent_staff_id)) : 'owner';
  const roleId = await ensureRole(USER_ROLE);
  const state = {
    role_id: roleId,
    role: 'USER',
    parent_staff_id: parentKind === 'owner' ? null : Number(row.parent_staff_id),
    parent_owner_id: parentKind === 'owner' ? ownerId : null,
    status: row.status === 'active' && !row.is_locked && !row.system_locked ? 'Active' : 'InActive',
    bet_locked: Boolean(row.sports_betlocked) || (row.bet_status != null && row.bet_status !== 'active'),
    is_demo: Boolean(row.is_demo),
    demo_expires_at: row.demo_expires_at ?? null,
  };
  let user = await MsUser.findByPk(userId);
  if (!user) {
    const username = await freeUsername(row.name, MsUser, 'user_id', userId);
    user = await MsUser.create({ user_id: userId, username, password: '!', ...state });
  } else {
    await user.update(state);
  }
  await ensureWallet(userId, 'USER', user.username);
  // A player's sports balance is the platform wallet, credits.inr (bets debit it, settlement pays
  // into it). Every player normally has the row already; this covers one that does not.
  await sequelize.query('INSERT INTO public.credits (uid) VALUES (:id) ON CONFLICT (uid) DO NOTHING', {
    replacements: { id: userId },
  });
  markFresh(key);
}
