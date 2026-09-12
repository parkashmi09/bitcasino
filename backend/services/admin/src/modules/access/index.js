'use strict';

/**
 * Executives and marketing accounts — sub-logins that act on behalf of a staff
 * member, with a subset of that member's authority.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE PERMISSION PAYLOAD WAS CHECKED FOR SHAPE, NOT CONTENT
 *
 *     const looksLikeStaffPermissions = (p) =>
 *       p && typeof p === 'object'
 *       && p.groups && typeof p.groups === 'object'
 *       && p.pages && typeof p.pages === 'object'
 *       && p.authority && typeof p.authority === 'object';
 *
 * That is the entire validation. It confirms three keys exist and are objects;
 * it never looks at what is IN them, and it never compares them to what the
 * creating staff member actually holds.
 *
 * So any staff member who could create an executive could create one carrying
 * permissions they do not have themselves, and then log in as it. The only
 * thing standing in the way is `resolvePermissions`, which intersects the
 * executive's grant with the parent's at TOKEN-ISSUANCE time — real defence,
 * but defence in one place. Two consequences follow anyway:
 *
 *   A promoted parent silently promotes every executive beneath them, because
 *   the oversized grant was stored and is only ever trimmed at login.
 *
 *   The stored row is a lie about what that executive can do, so every screen
 *   and every audit entry reading `permissions` directly is wrong.
 *
 * The grant is intersected at WRITE time here, so what is stored is what
 * applies. The read-time intersection stays — two independent gates on the
 * same thing.
 *
 * ── AND THE SCHEMA WAS CREATED FROM A REQUEST HANDLER ────────────────────
 *
 *     async function ensureAccessSchema() {
 *       if (_accessSchemaReady) return;
 *       try { await pg.query(`CREATE TABLE IF NOT EXISTS executives (...)`) }
 *       catch (e) { console.warn('[ensureAccessSchema] failed:', e?.message); }
 *     }
 *
 * called at the top of six handlers. DDL on the request path, racing between
 * processes on a cold start — and the failure is SWALLOWED, so a request whose
 * table creation failed carries on and dies on the SELECT with an error that
 * says nothing about why. `executives` is in the schema; migrations create
 * tables.
 *
 * ── A SIX-CHARACTER PASSWORD GUARDED AN OPERATOR ACCOUNT ─────────────────
 *
 *     if (password.length < 6) return res.status(400).json(...)
 *
 * for a login that carries staff authority.
 */
module.exports = {
  name: 'access',
  service: 'admin',
  basePath: '/access',
  models: ['admin', 'core'],
  routers: {
    admin: require('./routes/admin.routes'),
  },
};
