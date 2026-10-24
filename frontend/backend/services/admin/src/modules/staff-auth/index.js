'use strict';

/**
 * Staff and executive sign-in.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE PLAINTEXT PASSWORD WAS WRITTEN TO THE APPLICATION LOG
 *
 *     console.log('Login attempt with email:', email);
 *     console.log('Login attempt with password:', password ? password : 'undefined');
 *
 * The second line of the login handler. Every staff password, in cleartext, in
 * whatever the process's stdout is piped to — pm2 logs, a file, a log shipper,
 * a retention bucket. Anyone who has ever had read access to those files has
 * every operator credential on this platform, historically, and rotating the
 * passwords is the only remedy.
 *
 * ── AND THE ERRORS TOLD YOU WHICH HALF WAS WRONG ─────────────────────────
 *
 *     if (!rows.length)  return res.status(400).json({ message: 'Bad email' });
 *     if (!(await bcrypt.compare(...))) return res.status(400).json({ message: 'Bad password' });
 *
 * Two distinguishable answers, so the endpoint enumerates staff accounts. The
 * timing differs too — a bad email skips the bcrypt compare entirely, which is
 * measurable without reading the message at all. One answer here, and the
 * comparison runs either way.
 *
 * ── NOTHING LIMITED THE ATTEMPTS ─────────────────────────────────────────
 *
 * No lockout, no delay, no counter. Unlimited guesses against an account that
 * can move money.
 *
 * ── A SUSPENDED ACCOUNT COULD STILL SIGN IN ──────────────────────────────
 *
 * The handler checked `system_locked` and the ancestor chain, but never
 * `status` — so an account set to `suspended` through the staff management
 * screen kept working. Both are checked here, and only AFTER the password is
 * proven: a locked account should not be discoverable without it.
 *
 * ── ON THE PLAYER SIDE, THE SIGNING KEY IS A LITERAL ─────────────────────
 *
 * Not this module's routes, but found while reading them and too important to
 * leave in a commit message: `legacy/Users/Rule.js` signs PLAYER tokens with
 *
 *     jwt.sign({ id: user_id, username: result.name }, "keyboardca4ever", ...)
 *
 * a hardcoded string, also present in `index.js`. Anyone holding this source
 * can mint a valid session for any player id. It is at the top of the rotation
 * list. Staff tokens use `process.env.JWT_SECRET`, so the two are at least
 * separate — a player token cannot be presented as a staff one.
 */
module.exports = {
  name: 'staff-auth',
  service: 'admin',
  basePath: '/auth',
  routers: {
    // Sign-in cannot require a token. `public` is an AUDIENCE, not a path
    // segment — it mounts at /api/v1/admin/auth and the loader attaches no
    // guard, which is the only correct arrangement for a login route.
    public: require('./routes/public.routes'),
    /**
     * user-service asks whether a staff id is still active, because its socket
     * transport accepts staff connections for the four moderation events that
     * have to broadcast to player sockets. `staff` is in the `admin` model
     * domain and stays there.
     */
    internal: require('./routes/internal.routes'),
    admin: require('./routes/admin.routes'),
  },
  models: ['admin'],
};
