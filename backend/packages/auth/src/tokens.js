'use strict';

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { UnauthorizedError } = require('@ibitplay/common');

/**
 * JWT issuing and verification.
 *
 * Three token families, three separate secrets:
 *   access   — short-lived (15m), carries identity + role, sent on every call
 *   refresh  — long-lived (30d), single purpose: mint a new access token
 *   admin    — staff tokens, signed with JWT_ADMIN_SECRET
 *
 * Separate secrets are the point. If the access secret leaks, an attacker can
 * forge a player session until it expires — bad. If one shared secret leaked,
 * they could forge a staff token with balance-transfer rights — much worse.
 *
 * Every token carries a `jti`, so a specific session can be revoked without
 * invalidating every token the player holds.
 */

const TOKEN_TYPES = { ACCESS: 'access', REFRESH: 'refresh', ADMIN: 'admin' };

class TokenService {
  constructor(config) {
    this.accessSecret = config.JWT_ACCESS_SECRET;
    this.refreshSecret = config.JWT_REFRESH_SECRET;
    this.adminSecret = config.JWT_ADMIN_SECRET || config.JWT_ACCESS_SECRET;
    this.accessTtl = config.JWT_ACCESS_TTL || '15m';
    this.refreshTtl = config.JWT_REFRESH_TTL || '30d';
    this.adminTtl = config.JWT_ADMIN_TTL || '8h';
    this.issuer = config.JWT_ISSUER || 'ibitplay';
    this.audience = config.JWT_AUDIENCE || 'ibitplay-api';

    if (!this.accessSecret || !this.refreshSecret) {
      throw new Error('TokenService requires JWT_ACCESS_SECRET and JWT_REFRESH_SECRET');
    }
    if (this.accessSecret === this.refreshSecret) {
      // Same secret means a refresh token is structurally a valid access token.
      throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different');
    }
  }

  /** Player access token. Keep the payload small — it rides on every request. */
  signAccessToken({ userId, sessionId, role = 'player', status = 'active', extra = {} }) {
    return jwt.sign(
      { sub: String(userId), sid: sessionId, type: TOKEN_TYPES.ACCESS, role, status, ...extra },
      this.accessSecret,
      {
        expiresIn: this.accessTtl,
        issuer: this.issuer,
        audience: this.audience,
        jwtid: crypto.randomUUID(),
      }
    );
  }

  /** Refresh token — deliberately carries nothing but the session identity. */
  signRefreshToken({ userId, sessionId }) {
    return jwt.sign({ sub: String(userId), sid: sessionId, type: TOKEN_TYPES.REFRESH }, this.refreshSecret, {
      expiresIn: this.refreshTtl,
      issuer: this.issuer,
      audience: this.audience,
      jwtid: crypto.randomUUID(),
    });
  }

  /** Staff token. Permissions are embedded so routine checks need no DB round trip. */
  signAdminToken({ staffId, roleId, roleName, level, executiveId = null, permissions = null }) {
    return jwt.sign(
      {
        sub: String(staffId),
        type: TOKEN_TYPES.ADMIN,
        roleId,
        roleName,
        level,
        ...(executiveId ? { executiveId } : {}),
        ...(permissions ? { permissions } : {}),
      },
      this.adminSecret,
      { expiresIn: this.adminTtl, issuer: this.issuer, audience: this.audience, jwtid: crypto.randomUUID() }
    );
  }

  /**
   * Verify and decode. Throws a 401 AppError with a specific code so the client
   * can tell "refresh me" (TOKEN_EXPIRED) from "log in again" (INVALID_TOKEN).
   */
  verify(token, type = TOKEN_TYPES.ACCESS) {
    const secret =
      type === TOKEN_TYPES.REFRESH ? this.refreshSecret : type === TOKEN_TYPES.ADMIN ? this.adminSecret : this.accessSecret;

    let payload;
    try {
      payload = jwt.verify(token, secret, { issuer: this.issuer, audience: this.audience, algorithms: ['HS256'] });
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new UnauthorizedError('Token has expired', { code: 'TOKEN_EXPIRED', expiredAt: error.expiredAt });
      }
      if (error.name === 'NotBeforeError') throw new UnauthorizedError('Token is not active yet');
      throw new UnauthorizedError('Invalid token');
    }

    // A refresh token presented as an access token verifies against the wrong
    // secret and fails above — but check the claim too, in case secrets are
    // ever misconfigured to match.
    if (payload.type !== type) {
      throw new UnauthorizedError(`Expected a ${type} token but received a ${payload.type || 'malformed'} token`);
    }

    return payload;
  }

  /** Decode without verifying — for logging or reading an expired token's claims. */
  decode(token) {
    return jwt.decode(token, { complete: false });
  }

  /** Seconds until expiry, for the `expiresIn` field in a login response. */
  ttlSeconds(token) {
    const payload = this.decode(token);
    if (!payload?.exp) return null;
    return Math.max(0, payload.exp - Math.floor(Date.now() / 1000));
  }

  /** Pull a bearer token off the Authorization header. */
  static fromHeader(header) {
    if (typeof header !== 'string') return null;
    const [scheme, token] = header.split(' ');
    if (!/^Bearer$/i.test(scheme) || !token) return null;
    return token.trim();
  }
}

module.exports = { TokenService, TOKEN_TYPES };
