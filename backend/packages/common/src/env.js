'use strict';

/**
 * Environment loading and validation.
 *
 * Every service calls `loadEnv()` once at boot with a zod schema describing the
 * variables it actually needs. A service that is missing a required variable
 * fails immediately with a readable message instead of throwing something
 * cryptic on the first request that happens to touch it.
 *
 * The root `.env` is shared by every service; a service-local `.env` (if
 * present) is layered on top so a single service can be pointed somewhere else
 * without disturbing the others.
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { z } = require('zod');

/** Walk up from `startDir` looking for the workspace root (the dir holding package.json with workspaces). */
function findRepoRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 10; i += 1) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.workspaces) return dir;
      } catch {
        /* unreadable package.json — keep walking */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

let loaded = false;

/** Load root `.env` then the service-local `.env`, without overriding real process env. */
function loadDotenvFiles(serviceDir) {
  if (loaded) return;
  const root = findRepoRoot(serviceDir || process.cwd());
  const candidates = [
    path.join(root, '.env'),
    serviceDir ? path.join(serviceDir, '.env') : null,
  ].filter(Boolean);

  for (const file of candidates) {
    if (fs.existsSync(file)) dotenv.config({ path: file, override: false });
  }
  loaded = true;
}

/** Coerce the strings dotenv gives us into the types services actually want. */
const coercers = {
  /** "true"/"1"/"yes" -> true. Anything else falsy. */
  bool: (def = false) =>
    z
      .string()
      .optional()
      .transform((v) => (v === undefined || v === '' ? def : ['true', '1', 'yes', 'on'].includes(v.toLowerCase()))),

  int: (def) =>
    z
      .string()
      .optional()
      .transform((v) => (v === undefined || v === '' ? def : Number(v)))
      .pipe(z.number().int('must be an integer')),

  num: (def) =>
    z
      .string()
      .optional()
      .transform((v) => (v === undefined || v === '' ? def : Number(v)))
      .pipe(z.number('must be a number')),

  /** Comma-separated list -> trimmed string array. */
  list: (def = []) =>
    z
      .string()
      .optional()
      .transform((v) =>
        v === undefined || v.trim() === ''
          ? def
          : v.split(',').map((s) => s.trim()).filter(Boolean)
      ),

  str: (def) => (def === undefined ? z.string().min(1) : z.string().optional().transform((v) => (v === undefined || v === '' ? def : v))),

  optionalStr: () => z.string().optional().transform((v) => (v === '' ? undefined : v)),

  secret: (minLength = 32) =>
    z
      .string({ required_error: 'is required' })
      .min(minLength, `must be at least ${minLength} characters`),
};

/**
 * Validate `process.env` against `shape` and return the parsed config object.
 * Throws a single error listing every problem, so one run surfaces every fix.
 */
function loadEnv(shape, { serviceDir } = {}) {
  loadDotenvFiles(serviceDir);

  const schema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.string().default('info'),
    ...shape,
  });

  const result = schema.safeParse(process.env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    const err = new Error(`Invalid environment configuration:\n${details}`);
    err.name = 'EnvValidationError';
    throw err;
  }
  return result.data;
}

/** Base variables every HTTP service shares. */
/**
 * The shared cache.
 *
 * `loadEnv` only exposes keys a shape DECLARES — an undeclared variable is
 * absent from `config` no matter what `.env` says. `REDIS_URL` sat in `.env`
 * undeclared, so `config.REDIS_URL` was `undefined` and every service silently
 * took the in-process fallback while the file said otherwise.
 */
const cacheEnvShape = {
  REDIS_URL: coercers.str(''),
  REDIS_PREFIX: coercers.str('ibitplay'),
};

const httpEnvShape = {
  ...cacheEnvShape,
  LOG_PRETTY: coercers.bool(false),
  // Master switch for every rate-limit bucket. Only ever false for test runs.
  RATE_LIMIT_ENABLED: coercers.bool(true),
  CORS_ORIGIN: coercers.list(['*']),

  /**
   * Browser origins allowed to open a SOCKET.
   *
   * ── DECLARED HERE BECAUSE THREE SERVICES READ IT ─────────────────────
   *
   * user-service, casino-service and sports-service each attach a Socket.io
   * server, and each reads `config.SOCKET_ALLOWED_ORIGINS`. It was read before
   * it was declared anywhere — and `loadEnv` parses `process.env` through a
   * zod object, which STRIPS keys the shape does not name. So the value never
   * reached the config, `parseOrigins` always saw `undefined`, and every
   * transport's allowlist was empty: no browser could connect to any of them.
   *
   * Separate from `CORS_ORIGIN` on purpose. That one defaults to `*` because a
   * public HTTP API is called from anywhere; a socket carries an authenticated
   * session for its whole lifetime, and `*` on a credentialed connection is a
   * different proposition.
   *
   * NO DEFAULT. An unset value means no browser origin connects, which fails
   * visibly. Legacy hardcoded a list of eight in the middle of `index.js` —
   * including three localhost ports and a duplicate — and then only consulted
   * it when `config.developer` was true, so production accepted every origin.
   */
  SOCKET_ALLOWED_ORIGINS: coercers.list([]),

  BODY_LIMIT: coercers.str('1mb'),
  TRUST_PROXY: coercers.int(1),
  REQUEST_TIMEOUT_MS: coercers.int(30_000),
  RATE_LIMIT_WINDOW_MS: coercers.int(60_000),
  RATE_LIMIT_MAX: coercers.int(300),
  INTERNAL_API_KEY: coercers.secret(16),
};

/**
 * Database variables. Every service connects to the SAME database — the split
 * is at the service boundary, not the storage layer, so cross-domain reads
 * (a bet needs a balance) stay transactional instead of eventually consistent.
 */
const dbEnvShape = {
  DB_HOST: coercers.str('127.0.0.1'),
  DB_PORT: coercers.int(5432),
  DB_NAME: coercers.str('ibitplay'),
  DB_USER: coercers.str('postgres'),
  DB_PASSWORD: coercers.str(''),

  /**
   * Optional per-service database roles — see `resolveCredentials`.
   *
   * Unset means fall back to `DB_USER`, so an unmigrated deployment connects
   * exactly as before. Create them with `node tools/db-grants.js --apply`.
   */
  DB_USER_USER_SERVICE: coercers.optionalStr(),
  DB_PASSWORD_USER_SERVICE: coercers.optionalStr(),
  DB_USER_ADMIN_SERVICE: coercers.optionalStr(),
  DB_PASSWORD_ADMIN_SERVICE: coercers.optionalStr(),
  DB_USER_CASINO_SERVICE: coercers.optionalStr(),
  DB_PASSWORD_CASINO_SERVICE: coercers.optionalStr(),
  DB_USER_SPORTS_SERVICE: coercers.optionalStr(),
  DB_PASSWORD_SPORTS_SERVICE: coercers.optionalStr(),
  DB_SCHEMA: coercers.str('public'),
  DB_SSL: coercers.bool(false),
  DB_LOGGING: coercers.bool(false),
  DB_POOL_MAX: coercers.int(20),
  DB_POOL_MIN: coercers.int(2),
  DB_POOL_IDLE_MS: coercers.int(10_000),
  DB_POOL_ACQUIRE_MS: coercers.int(30_000),
  DB_STATEMENT_TIMEOUT_MS: coercers.int(30_000),
};

/** JWT variables shared by anything that issues or verifies player tokens. */
const jwtEnvShape = {
  JWT_ACCESS_SECRET: coercers.secret(32),
  JWT_REFRESH_SECRET: coercers.secret(32),
  JWT_ACCESS_TTL: coercers.str('15m'),
  JWT_REFRESH_TTL: coercers.str('30d'),
  JWT_ISSUER: coercers.str('ibitplay'),
  JWT_AUDIENCE: coercers.str('ibitplay-api'),
};

/** Staff tokens are signed with a different key so a leaked player secret can never mint an admin token. */
const adminJwtEnvShape = {
  JWT_ADMIN_SECRET: coercers.secret(32),
  JWT_ADMIN_TTL: coercers.str('8h'),
};

/**
 * Encryption at rest for second-factor secrets.
 *
 * A TOTP shared secret cannot be hashed — producing the code the phone shows
 * requires the original — so it is encrypted instead. Before this, it sat in
 * `users.two_fa` as plain base32, which made any copy of the database enough
 * to mint valid codes for every enrolled account.
 *
 * OPTIONAL, and deliberately so. When unset, `createSecretBox` derives the key
 * from `JWT_ADMIN_SECRET` with HKDF and warns loudly on every boot. That still
 * defeats the threat this exists for — a database copy read WITHOUT the
 * application's environment — while not taking a running platform down on
 * deploy over a variable nobody had been told to set.
 *
 * What the fallback costs is independent rotation: rotating `JWT_ADMIN_SECRET`
 * would make every stored 2FA secret unreadable. Set this.
 *
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
const secretEncryptionEnvShape = {
  TOTP_ENCRYPTION_KEY: coercers.optionalStr(),
};

/**
 * Per-service internal keys.
 *
 * The shared `INTERNAL_API_KEY` proves a caller is "one of our services" and
 * nothing more, so any service could reach any internal endpoint — including
 * `POST /internal/user/wallet/credit`, which mints balance. A per-service key
 * identifies WHICH service is calling, which is what makes the ACL in
 * `internalAcl.js` enforceable and makes audit attribution a fact rather than
 * a self-declared header.
 *
 * ALL OPTIONAL, and all-or-nothing in effect: until every one is set the
 * platform falls back to the shared key and the ACL is skipped, so an
 * unmigrated deployment behaves exactly as before. Generate four distinct
 * values with:
 *
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
const internalKeysEnvShape = {
  INTERNAL_KEY_USER_SERVICE: coercers.optionalStr(),
  INTERNAL_KEY_ADMIN_SERVICE: coercers.optionalStr(),
  INTERNAL_KEY_CASINO_SERVICE: coercers.optionalStr(),
  INTERNAL_KEY_SPORTS_SERVICE: coercers.optionalStr(),
};

/** Where the other services live, for inter-service calls. */
const serviceDiscoveryEnvShape = {
  USER_SERVICE_URL: coercers.str('http://127.0.0.1:4001'),
  ADMIN_SERVICE_URL: coercers.str('http://127.0.0.1:4002'),
  CASINO_SERVICE_URL: coercers.str('http://127.0.0.1:4003'),
  SPORTS_SERVICE_URL: coercers.str('http://127.0.0.1:4004'),
  SERVICE_TIMEOUT_MS: coercers.int(8_000),
  SERVICE_RETRIES: coercers.int(2),
};

module.exports = {
  cacheEnvShape,
  loadEnv,
  coercers,
  httpEnvShape,
  dbEnvShape,
  jwtEnvShape,
  adminJwtEnvShape,
  secretEncryptionEnvShape,
  internalKeysEnvShape,
  serviceDiscoveryEnvShape,
  z,
  findRepoRoot,
};
