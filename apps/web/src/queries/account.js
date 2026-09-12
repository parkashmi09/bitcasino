import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ENDPOINTS } from '@/lib/endpoints';
import { queryKeys } from '@/queries/keys';
import { useAuth } from '@/auth/AuthProvider';

/**
 * The account area's reads and writes: two-factor, sessions, KYC, and the
 * transaction history.
 *
 * Profile, preferences and referrals are NOT here — they landed with Phase 3
 * and live in `hooks/useProfile.js`, `hooks/usePreferences.js` and
 * `hooks/useReferral.js` as hand-rolled `useEffect` fetches. They are not
 * rewritten onto React Query as part of this phase: they work, they are
 * tested by use, and churning them would be a large diff with no behaviour
 * change. New surfaces use the query layer; that is the direction, not a
 * migration.
 *
 * @see docs/10-backend-integration.md, Phase 6.
 */

/* ═══════════════════════════════════════════════════════════════════════
 * Two-factor authentication
 *
 * The setup is a three-step handshake and the order matters:
 *
 *   1. `POST /2fa/enable`        mints a secret, answers {qrCode, secret}
 *   2. the player scans it and reads a code off their authenticator
 *   3. `POST /2fa/setup-verify`  confirms with that code -> {enabled: true}
 *
 * **Step 1 is not idempotent.** Calling it again mints a NEW secret and
 * overwrites the stored one, so a player who scanned the first QR would be
 * typing codes from a secret the server has already discarded. That is why
 * `useBeginTwoFactor` is a mutation the dialog fires ONCE on open, and the
 * dialog holds the answer in state rather than re-reading it.
 *
 * A setup abandoned between 1 and 2 leaves `hasInitiated: true` with
 * `isEnabled: false`. That is a real state and the card says so, because a
 * player looking at "Inactive" who already scanned a QR needs to know their
 * app has a secret the account is not using yet.
 * ═══════════════════════════════════════════════════════════════════════ */

/** `{isEnabled, hasInitiated}`. */
export function useTwoFactorStatus() {
  const { status } = useAuth();

  return useQuery({
    queryKey: queryKeys.account.twoFactor(),
    queryFn: ({ signal }) => api(ENDPOINTS.twoFactorStatus, { signal }),
    enabled: status === 'authenticated',
    /**
     * Zero. This is a security setting: after enabling or disabling it, a
     * stale read showing the previous state is the one thing this card must
     * never do.
     */
    staleTime: 0,
  });
}

/**
 * Begin setup. Answers `{qrCode, secret}` — the QR is a data URL and the
 * secret is the base32, for a player entering it by hand.
 *
 * `retry: false`: a retry mints a second secret and invalidates the QR the
 * player may already have scanned.
 */
export function useBeginTwoFactor() {
  return useMutation({
    mutationFn: () => api(ENDPOINTS.twoFactorEnable, { method: 'POST' }),
    retry: false,
  });
}

/** Confirm setup with a code from the authenticator app. */
export function useCompleteTwoFactor() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ code }) =>
      api(ENDPOINTS.twoFactorSetupVerify, { method: 'POST', body: { code } }),
    retry: false,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.account.twoFactor() });
    },
  });
}

/**
 * Turn the second factor off. Takes the CODE and the PASSWORD.
 *
 * Both, because this is the one action that lowers the account's security:
 * it needs the factor itself and the thing that factor protects. The password
 * is an argument and nothing else holds it — not a query key, not the cache
 * — for the same reasons as the withdrawal form in `queries/wallet.js`.
 */
export function useDisableTwoFactor() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ code, password }) =>
      api(ENDPOINTS.twoFactorDisable, { method: 'POST', body: { code, password } }),
    retry: false,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.account.twoFactor() });
    },
  });
}

/* ═══════════════════════════════════════════════════════════════════════
 * Sessions
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Every unrevoked, unexpired refresh session on the account.
 *
 * Rows are `{id, ip_address, user_agent, device_label, last_used_at,
 * created_at, expires_at}` — snake_case, straight off `auth_sessions`, and
 * NOT adapted, because this list is a security surface where the raw record
 * is the point. `device_label` is the server's own summary of the
 * user-agent ("Chrome on Windows") and is null for a client it cannot
 * summarise, such as curl.
 *
 * **There is no per-session revoke route.** `POST /auth/logout` takes
 * `{refreshToken}` for one session or `{allSessions: true}` for every one,
 * and nothing addresses a session by id. So the card offers "sign out
 * everywhere" and does not draw a per-row button that could not work.
 */
export function useSessions() {
  const { status } = useAuth();

  return useQuery({
    queryKey: queryKeys.account.sessions(),
    queryFn: ({ signal }) => api(ENDPOINTS.sessions, { signal }),
    enabled: status === 'authenticated',
    staleTime: 30 * 1000,
  });
}

/* ═══════════════════════════════════════════════════════════════════════
 * KYC
 * ═══════════════════════════════════════════════════════════════════════ */

/** What the submit form may attach a file to. From `kyc.constants.js`. */
export const KYC_DOCUMENT_FIELDS = Object.freeze(['idFront', 'idBack', 'passport']);

/** Accepted by MAGIC BYTES on the server, not by the declared mimetype. */
export const KYC_ACCEPTED_TYPES = Object.freeze(['image/jpeg', 'image/png', 'application/pdf']);

/** `MAX_FILE_BYTES` — 5 MB, per file. */
export const KYC_MAX_BYTES = 5 * 1024 * 1024;

/**
 * The player's own KYC state: `{status, submitted, rejectionReason?}`.
 *
 * `status` is `NotSubmitted` until they apply, then `Pending` / `Verified` /
 * `Rejected`.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THIS REPLACES `useKyc` IN `hooks/useProfile.js`, AND THE REASON IS A BUG
 * THIS PHASE ALREADY HIT ONCE.
 *
 * That hook was a hand-rolled `useEffect` fetch, so it held nothing in the
 * query cache — and `useSubmitKyc` below invalidates
 * `queryKeys.account.kyc()`. An invalidation matching zero queries is
 * **silent**: submitting would have left the identity card reading
 * "NotSubmitted" beside a "Start verification" button, for documents already
 * in the review queue, until the next full remount.
 *
 * That is exactly the defect Phase 5 found between `usePlayRound` and
 * `useBalances`. Rather than add a second refresh signal, the read moves onto
 * the query layer, where the mutation beside it can actually reach it.
 * ═════════════════════════════════════════════════════════════════════════
 */
export function useKycStatus() {
  const { status } = useAuth();

  return useQuery({
    queryKey: queryKeys.account.kyc(),
    queryFn: ({ signal }) => api(ENDPOINTS.kycStatus, { signal }),
    enabled: status === 'authenticated',
    staleTime: 60 * 1000,
  });
}

/**
 * Submit identity documents.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * MULTIPART, AND THE CONTENT-TYPE MUST NOT BE SET.
 *
 * `api.js` detects a `FormData` body and omits the header, because only the
 * browser knows the boundary it generated. Sending `multipart/form-data`
 * without one gives multer nothing to split on, and the failure does not look
 * like a header problem — measured against the running service, the same body
 * answers `500 INTERNAL_ERROR "Something went wrong"` with the header and
 * `201 {id, status: 'Pending'}` without it.
 *
 * The server checks the file's MAGIC BYTES rather than its declared type,
 * and holds uploads in memory until it has, so a refused file never touches
 * the filesystem. `accept` on the input and the size check below are a
 * courtesy to the player, not the security boundary — that is server-side
 * and stays there.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * `retry: false`: a submission writes a review row and re-sending it queues
 * the same documents twice for a human to look at.
 */
export function useSubmitKyc() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ files, ...fields }) => {
      const form = new FormData();

      // The seven text fields the validator requires, plus the optional
      // `gender`. `dateOfBirth` goes as the `yyyy-mm-dd` the date input
      // produces; `z.coerce.date()` parses it.
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined && value !== null && value !== '') form.append(key, value);
      }

      for (const field of KYC_DOCUMENT_FIELDS) {
        if (files?.[field]) form.append(field, files[field]);
      }

      return api(ENDPOINTS.kycSubmit, { method: 'POST', body: form });
    },
    retry: false,
    onSuccess: () => {
      // The status moves `NotSubmitted` -> `Pending`, and the account page's
      // identity card branches on it.
      client.invalidateQueries({ queryKey: queryKeys.account.kyc() });
    },
  });
}

/* ═══════════════════════════════════════════════════════════════════════
 * Transaction history
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Every deposit and withdrawal, across all seven rails.
 *
 * Answers `{deposits: {count, rows}, withdrawals: {count, rows}}` — two
 * sides, each separately counted, **not** a flat list and **not**
 * `meta.pagination`. They are merged from different tables and there is no
 * single total that would mean anything.
 *
 * **Offset-based**, and the offset is capped at 10,000 server-side: the
 * endpoint reads `offset + limit` rows from each of the seven tables to know
 * which survive the sort, so an unbounded offset makes one request read every
 * payment row a player has.
 */
export function useTransactionHistory({ limit = 25, offset = 0, enabled = true } = {}) {
  const { status } = useAuth();

  return useQuery({
    queryKey: queryKeys.account.history(limit, offset),
    queryFn: ({ signal }) => api(ENDPOINTS.history, { query: { limit, offset }, signal }),
    enabled: enabled && status === 'authenticated',
    staleTime: 30 * 1000,
  });
}

/**
 * Player-to-player transfers — tips sent and received.
 *
 * A separate call rather than a third key on the combined read: a transfer is
 * neither a deposit nor a withdrawal, and the combined endpoint has no rail
 * for it. This one IS a plain list with `meta.pagination`.
 */
export function useTransfers({ limit = 25, offset = 0, enabled = true } = {}) {
  const { status } = useAuth();

  return useQuery({
    queryKey: queryKeys.account.transfers(limit, offset),
    queryFn: ({ signal }) =>
      api(ENDPOINTS.historyTransfers, { query: { limit, offset }, signal }),
    enabled: enabled && status === 'authenticated',
    staleTime: 30 * 1000,
  });
}
