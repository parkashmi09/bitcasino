'use strict';

/**
 * What an OTP may be for.
 *
 * `register` is the interesting one. Legacy accepted it and could never fulfil
 * it: `user_otps.email` carries a FOREIGN KEY to `users(email)`, so an OTP for
 * an address that has not registered yet violates the constraint. Every
 * registration OTP the platform has ever attempted failed with
 *
 *     insert or update on table "user_otps" violates foreign key constraint "fk_email"
 *
 * The constraint is dropped in migration 018, because it encodes the opposite
 * of what a registration OTP is for.
 */
const PURPOSE = Object.freeze({
  REGISTER: 'register',
  LOGIN: 'login',
  RESET_PASSWORD: 'reset-password',
  RESET_2FA: 'reset-2fa',
  /**
   * Proving you can receive mail at an address before it becomes yours.
   *
   * NEW — legacy had no such step. `Rule.editAccount` wrote the new address
   * straight in:
   *
   *     UPDATE users SET email = $1 WHERE id = $2
   *
   * with no confirmation that anyone could read mail there. Since password
   * reset delivers to `users.email`, an unverified change hands the reset path
   * to whatever was typed — including a typo, which locks the player out of
   * their own recovery permanently.
   *
   * Deliberately NOT in `REQUIRES_ACCOUNT`: the code goes to the address the
   * player is moving TO, which by definition has no account on it.
   */
  CHANGE_EMAIL: 'change-email',
});

const PURPOSES = Object.freeze(Object.values(PURPOSE));

/** Purposes that require an existing account. `register` is the exception. */
const REQUIRES_ACCOUNT = Object.freeze(
  new Set([PURPOSE.LOGIN, PURPOSE.RESET_PASSWORD, PURPOSE.RESET_2FA])
);

/**
 * How long a code is good for, how many guesses it gets, and how often one may
 * be asked for.
 *
 * ── THE COOLDOWN WAS ONLY ON ONE OF THE TWO ROUTES ───────────────────────
 * `/otp/resend` checked `canResendOTP`. `/otp/send` did not — and `/otp/send`
 * DELETES the previous unverified code before issuing a new one:
 *
 *     DELETE FROM user_otps WHERE email = $1 AND purpose = $2 AND is_verified = FALSE
 *
 * So calling `/otp/send` in a loop reset the attempt counter every time, and
 * sent an email every time. Unlimited mail to any registered address, and an
 * attempt limit that could never be reached. The cooldown applies to issuing a
 * code, not to which route asked for it.
 */
const OTP_TTL_SECONDS = 120;
const OTP_MAX_ATTEMPTS = 3;
const OTP_RESEND_COOLDOWN_SECONDS = 120;

/** Digits in a code. */
const OTP_LENGTH = 6;

/**
 * bcrypt cost for hashing a code.
 *
 * Lower than the cost used for passwords (12), deliberately. A password is
 * long-lived and unlimited-guess, so it needs every millisecond it can get. A
 * code lives for two minutes and gets three attempts, and the endpoint that
 * hashes it is UNAUTHENTICATED — at cost 12 each request burns ~225ms of CPU,
 * which is a denial-of-service lever anyone can pull.
 *
 * Cost 8 is ~25ms: still far beyond a fast hash for anyone who steals the
 * table, and it does not hand out a CPU amplifier.
 */
const OTP_HASH_ROUNDS = 8;

/**
 * How long a verified code stays usable as proof.
 *
 * A code is verified in one request and spent in another — verify the OTP, then
 * reset the 2FA. Without a window the verification is either useless or
 * permanent.
 */
const OTP_PROOF_TTL_SECONDS = 300;

module.exports = {
  PURPOSE,
  PURPOSES,
  REQUIRES_ACCOUNT,
  OTP_TTL_SECONDS,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_LENGTH,
  OTP_HASH_ROUNDS,
  OTP_PROOF_TTL_SECONDS,
};
