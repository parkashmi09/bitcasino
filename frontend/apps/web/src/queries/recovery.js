import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ENDPOINTS } from '@/lib/endpoints';

/**
 * Password recovery: the three calls that get a locked-out player back in.
 *
 *   1. `POST /user/email/otp`            issue a code to the address
 *   2. `POST /user/email/otp/verify`     check it
 *   3. `POST /user/auth/reset-password`  set the new password
 *
 * @see docs/10-backend-integration.md
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ALL THREE ARE `auth: false`, AND THAT IS THE WHOLE POINT.
 *
 * A player who has forgotten their password has no token, so every call here
 * is unauthenticated by necessity. `api.js` would otherwise attach whatever
 * access token happens to be in memory and — worse — try to REFRESH it on a
 * 401, which for a signed-out visitor means a refresh attempt, a failure, and
 * `tokenStore.clear()` firing in the middle of a recovery flow.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * There are no queries here, only mutations. Every step is an action with a
 * side effect — an email sent, an attempt counted, a password changed — and
 * none of them is a thing to cache, retry or refetch on focus.
 */

/**
 * What the codes in this flow are for.
 *
 * `PURPOSES` on the backend is a `z.enum`, so a value not in it is a 422
 * before the handler runs. It is also what CONFINES the code: a `reset-2fa`
 * or `login` code goes to the same inbox and lives in the same table, and
 * without the purpose in the lookup one of those would also reset a password
 * — which is the more valuable of the two actions.
 */
export const OTP_PURPOSE = 'reset-password';

/** Digits in a code, from `OTP_LENGTH`. The form will not submit fewer. */
export const OTP_LENGTH = 6;

/**
 * How long the player has to type the code, from `OTP_TTL_SECONDS`.
 *
 * Mirrored here for the countdown rather than read from the response: the
 * request answers `{requested, expiresAt}`, and the page prefers the server's
 * own `expiresAt` when it has one. This is the fallback and the copy.
 */
export const OTP_TTL_SECONDS = 120;

/**
 * Step one — send a code to the address.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * SUCCESS HERE DOES NOT MEAN THE ADDRESS HAS AN ACCOUNT.
 *
 * The service answers `{requested: true}` identically whether or not it found
 * a user, and sends nothing in the second case. That is deliberate — legacy
 * answered "User not found" and turned the reset box into a membership check,
 * which is a free list of which addresses are registered.
 *
 * So the screen after this step must never say "we found your account" or
 * "check your inbox — it's on its way". It says what was DONE (a code was
 * sent if that address is registered), not what was found. The copy in
 * `ForgotPassword.jsx` is written to that rule, and it is the kind of thing a
 * later well-meaning edit undoes.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * The one refusal that IS distinguishable is the cooldown, and it is safe:
 * `EMAIL_OTP_COOLDOWN` fires on an outstanding code for that address, which
 * the caller only reaches by having asked a moment ago themselves.
 */
export function useRequestResetCode() {
  return useMutation({
    mutationFn: (email) =>
      api(ENDPOINTS.emailOtp, {
        method: 'POST',
        auth: false,
        body: { email, purpose: OTP_PURPOSE },
      }),
    /* No retry. Each attempt sends an email to a real inbox and each one
       counts against a 5-per-minute bucket; an automatic second try is how a
       player gets two codes and the first one stops working. */
    retry: false,
  });
}

/**
 * Step two — check the code.
 *
 * Three attempts per code (`OTP_MAX_ATTEMPTS`), counted in the database
 * rather than read-modify-written, so simultaneous guesses each cost one.
 * After that the code is dead and a new one must be requested — which is what
 * `EMAIL_OTP_TOO_MANY_ATTEMPTS` means, and why the page sends the player back
 * to step one rather than letting them keep typing.
 *
 * On success the row is marked verified and becomes PROOF for 300 seconds
 * (`OTP_PROOF_TTL_SECONDS`). Step three has to land inside that window.
 */
export function useVerifyResetCode() {
  return useMutation({
    mutationFn: ({ email, code }) =>
      api(ENDPOINTS.emailOtpVerify, {
        method: 'POST',
        auth: false,
        body: { email, purpose: OTP_PURPOSE, code },
      }),
    /* Certainly no retry — a retried wrong code spends two of the three
       attempts on one guess. */
    retry: false,
  });
}

/**
 * Step three — set the new password.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * THE CODE IS SENT AGAIN, AND IT IS NOT REDUNDANT.
 *
 * The proof left by step two is keyed on the ADDRESS and the purpose. Where
 * the platform already used that pattern — `profile.changeEmail` — the
 * request spending the proof carries the account holder's own token, so the
 * proof only has to answer "did they also demonstrate they can read mail
 * there". This route has no token by definition.
 *
 * Without the code, the five minutes after a victim verifies would be a
 * window in which any caller naming that address owns the account, having
 * never seen the code. Re-checking it makes the proof a record that the code
 * was used recently rather than a bearer credential of its own.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Answers `{reset, revokedSessions}` and **no session**. Every session on the
 * account was just revoked — a reset is what somebody does when they believe
 * it is compromised — so the player signs in with the new password rather
 * than arriving signed in. `revokedSessions` is worth showing: "you have been
 * signed out on 3 devices" is the confirmation that the thing they were
 * worried about has been undone.
 */
export function useResetPassword() {
  return useMutation({
    mutationFn: ({ email, code, newPassword }) =>
      api(ENDPOINTS.resetPassword, {
        method: 'POST',
        auth: false,
        body: { email, code, newPassword },
      }),
    retry: false,
  });
}
