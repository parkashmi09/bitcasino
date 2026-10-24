'use strict';

const { TokenService, TOKEN_TYPES } = require('@ibitplay/auth');

/**
 * Verify the bearer token once, at the edge, and pass identity downstream as
 * trusted headers.
 *
 * Signature verification is pure CPU and does not need the database, so doing
 * it here means a request with a forged or expired token never costs an
 * upstream hop. What the gateway does NOT do is decide whether the account is
 * usable — that is a live database read, and it belongs to the service that
 * owns the record. A locked player still holds a structurally valid token; the
 * service is what notices.
 *
 * Nothing here rejects an anonymous request either. Public routes exist
 * (`/health`, the endpoint index, provider callbacks), and the service's own
 * `authenticate()` is what enforces the requirement per route. The gateway's
 * job is to make sure that IF identity is present, it is real.
 */
function verifyToken({ config, logger }) {
  const tokens = new TokenService(config);

  return function verifyTokenMiddleware(req, _res, next) {
    const raw = TokenService.fromHeader(req.headers.authorization);
    if (!raw) return next();

    // Player and staff tokens are signed with different secrets, so a leaked
    // player secret cannot mint staff authority. Which family this is, is
    // discovered by trying both — the token itself does not get to claim it.
    try {
      const payload = tokens.verify(raw, TOKEN_TYPES.ACCESS);
      req.headers['x-user-id'] = String(payload.sub);
      if (payload.sid) req.headers['x-session-id'] = String(payload.sid);
      if (payload.role) req.headers['x-roles'] = String(payload.role);
      req.identity = { kind: 'player', id: payload.sub };
      return next();
    } catch {
      /* not a player token — try staff */
    }

    try {
      const payload = tokens.verify(raw, TOKEN_TYPES.ADMIN);
      req.headers['x-staff-id'] = String(payload.sub);
      if (payload.executiveId) req.headers['x-executive-id'] = String(payload.executiveId);
      req.identity = { kind: 'staff', id: payload.sub };
      return next();
    } catch {
      /* neither — fall through */
    }

    // An invalid token is left to the upstream to reject, so the client gets
    // one consistent error shape whether the token was absent or bad. The
    // Authorization header is forwarded untouched; the identity headers are not
    // set, and `stripHeaders` already removed any the client tried to send.
    logger?.debug({ ip: req.ip, path: req.originalUrl }, 'Bearer token failed verification at the edge');
    return next();
  };
}

module.exports = { verifyToken };
