'use strict';

const { response, asyncHandler } = require('@ibitplay/common');
const google = require('../google');
// rainbet: refresh token in an httpOnly cookie for clients that ask (../refreshCookie.js).
const refreshCookie = require('../refreshCookie');

/** Unauthenticated auth endpoints — the ones that MINT a session. */
function createPublicController({ service }) {
  const context = (req) => ({ ip: req.ip, userAgent: req.headers['user-agent'], origin: req.headers.origin });

  return {
    register: asyncHandler(async (req, res) => {
      const result = await service.registerAndSignIn(req.body, context(req));
      // 201: the account is new. The session in the body is what makes this
      // one round trip instead of two.
      return response.created(res, refreshCookie.deliver(req, res, result));
    }),

    login: asyncHandler(async (req, res) => {
      const result = await service.login(req.body, context(req));
      return response.ok(res, refreshCookie.deliver(req, res, result));
    }),

    /** The Demo button: a throwaway demo account, signed in (`AuthService.demoLogin`). */
    demoLogin: asyncHandler(async (req, res) => response.created(res, refreshCookie.deliver(req, res, await service.demoLogin(context(req))))),

    refresh: asyncHandler(async (req, res) => {
      const result = await service.refresh(req.body, context(req));
      return response.ok(res, refreshCookie.deliver(req, res, result));
    }),

    /** Whether the player site should draw the Google button. */
    // rainbet: `enabled` is the owner's switch (the button shows even before keys are set); `configured` is the keys.
    googleStatus: asyncHandler(async (_req, res) =>
      response.ok(res, { enabled: await service.googleAllowed(), configured: service.googleConfigured() })
    ),

    /** 302 to Google, after setting the signed state cookie the callback needs. */
    googleStart: asyncHandler(async (req, res) => {
      // A browser navigation, not a fetch: switched off or no keys goes back to the site with a message.
      const unavailable = await service.googleUnavailable();
      if (unavailable) return res.redirect(302, service.googleReturnUrl({ error: unavailable }));
      const { url, cookie } = await service.googleStart({ nonce: req.query.nonce });
      res.cookie(google.COOKIE, cookie, {
        httpOnly: true,
        secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
        sameSite: 'lax', // Google's redirect back is a top-level GET, which Lax still carries.
        path: google.COOKIE_PATH,
        maxAge: 10 * 60_000,
      });
      return res.redirect(302, url);
    }),

    /** Google's redirect back → 302 to the player site with a one-time code (or an error code). */
    googleCallback: asyncHandler(async (req, res) => {
      const target = await service.googleCallback(
        { code: req.query.code, state: req.query.state, cookie: google.readCookie(req.headers.cookie) },
        context(req)
      );
      res.clearCookie(google.COOKIE, { path: google.COOKIE_PATH });
      return res.redirect(302, target);
    }),

    /** The one-time code → the token pair, as login answers it. */
    googleExchange: asyncHandler(async (req, res) => response.ok(res, refreshCookie.deliver(req, res, await service.googleExchange(req.body, context(req))))),

    /**
     * Create an account.
     *
     * `201`, because this is the one endpoint in the module that makes a row.
     * The service answers `{ id, name, email }` and deliberately no password
     * and no session — legacy returned the password to the client that had
     * just typed it, and registering does not sign you in here. The client
     * calls `login` next, which is also what the socket flow did.
     *
     * `id` is serialised because it is a bigint: `JSON.stringify` turns a JS
     * number past 2^53 into something that is not the id. Every other id on
     * this service's wire is a string for the same reason.
     */
    register: asyncHandler(async (req, res) => {
      const created = await service.register(req.body, context(req));
      return response.created(res, { ...created, id: String(created.id) });
    }),

    /**
     * Begin a password reset.
     *
     * THE REPLY IS THE SAME WHETHER OR NOT THE ADDRESS IS REGISTERED, and the
     * service computes it before it branches so the two paths cost the same
     * time as well. Passing that value straight through is the point — any
     * shaping here (a 404 for an unknown address, a different message) would
     * turn this into an account-enumeration oracle and undo that care.
     */
    requestPasswordReset: asyncHandler(async (req, res) => {
      const result = await service.requestPasswordReset(req.body, context(req));
      return response.ok(res, result);
    }),

    /** Finish a reset. The token is the credential, so there is no session. */
    completePasswordReset: asyncHandler(async (req, res) => {
      const result = await service.completePasswordReset(req.body);
      return response.ok(res, result);
    }),
  };
}

module.exports = { createPublicController };
