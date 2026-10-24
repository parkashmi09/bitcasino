'use strict';

/**
 * The sign-in attempt limit.
 *
 * Legacy had none — unlimited guesses against accounts that move money. These
 * numbers are deliberately unremarkable: enough to survive a mistyped password
 * a few times, few enough that an online guessing run is not practical.
 */
const LOGIN_MAX_ATTEMPTS = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/**
 * Cost factor for a staff password.
 *
 * Higher than the OTP factor (8) — this guards a credential rather than a
 * short-lived code, and staff sign-ins are rare enough that the work is not a
 * lever an attacker can pull at volume. Legacy used 10.
 */
const PASSWORD_ROUNDS = 12;

/**
 * The level at or above which a second factor is mandatory.
 *
 * ── LOWER NUMBER MEANS MORE AUTHORITY ────────────────────────────────────
 *
 *   1 SUPER_ADMIN   2 ADMIN   3 SUB_ADMIN   4 SUPER_MASTER
 *   5 MASTER        6 AGENT   7 EXECUTIVE
 *
 * So `<= 3` is super admins, admins and sub-admins. That is the set holding
 * `wallet:adjust`, `withdrawals:approve` and `roles:manage` — the grants where
 * a phished password is somebody else's money.
 *
 * ── WHY NOT EVERYONE ─────────────────────────────────────────────────────
 *
 * Agents and executives are numerous, often on shared or borrowed devices, and
 * their grants are narrow. Making enrolment mandatory for them at the same
 * moment it becomes mandatory for admins would lock a large population out of
 * the panel on deploy, and the pressure to relax the whole policy would come
 * from there rather than from where the risk is. They may still enrol, and it
 * is enforced for them once they do.
 *
 * Lower this number as enrolment spreads. Setting it to 7 requires 2FA of
 * every staff account on the platform.
 */
/**
 * Overridable per environment via `STAFF_2FA_REQUIRED_LEVEL`.
 *
 * THE DEFAULT IS THE SECURE VALUE (3). An unset, empty or unparseable variable
 * keeps the policy exactly as written above, so a deployment that forgets the
 * variable fails CLOSED rather than open.
 *
 * Setting it to 0 disables the enrolment requirement entirely: levels start at
 * 1, so no account satisfies `level <= 0`. That is a LOCAL DEVELOPMENT
 * convenience for signing in to a restored database whose senior accounts have
 * no authenticator enrolled. On a real deployment it hands every admin account
 * back its password-only sign-in — do not set it outside development.
 */
const TWO_FA_REQUIRED_AT_OR_ABOVE_LEVEL = (() => {
  const raw = process.env.STAFF_2FA_REQUIRED_LEVEL;
  if (raw === undefined || raw === '') return 3;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 7 ? parsed : 3;
})();

module.exports = {
  LOGIN_MAX_ATTEMPTS,
  LOGIN_WINDOW_MS,
  PASSWORD_ROUNDS,
  TWO_FA_REQUIRED_AT_OR_ABOVE_LEVEL,
};
