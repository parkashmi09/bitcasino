import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { ENDPOINTS } from '@/lib/endpoints';
import { useAuth } from '@/auth/AuthProvider';

/**
 * The player's own record. `GET /user/profile` answers `{ id, username, email,
 * phone, country, avatar, … }`; `PUT /user/profile` is `.strict()` and takes
 * `username`, `country` and `avatar` only, so `save` sends the country. The
 * account form draws nothing else it could not keep.
 */

/**
 * `{ profile, status, error, save, saving, saveError, reload }`.
 *
 * `profile` is the platform's record, `null` until it arrives. `status` is
 * `idle` for a signed-out visitor, so a caller can tell
 * "no account" from "an account still loading".
 */
export function useProfile() {
  const { status: session } = useAuth();

  const [state, setState] = useState({ profile: null, status: 'idle', error: null });
  const [save_, setSave] = useState({ saving: false, saveError: null });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (session !== 'authenticated') {
      setState({ profile: null, status: 'idle', error: null });
      return undefined;
    }

    const controller = new AbortController();
    setState((previous) => ({ ...previous, status: 'loading', error: null }));

    api(ENDPOINTS.profile, { signal: controller.signal })
      .then((profile) => setState({ profile: profile ?? null, status: 'ready', error: null }))
      .catch((error) => {
        if (error?.name === 'AbortError') return;
        setState({
          profile: null,
          status: 'error',
          error: error instanceof ApiError ? error : null,
        });
      });

    return () => controller.abort();
  }, [session, nonce]);

  /** Sends the country; an unchanged one is not a request (the route refuses an empty body). */
  const save = useCallback(
    async (values) => {
      const country = String(values.country ?? '').trim();
      if (country === (state.profile?.country ?? '')) {
        setSave({ saving: false, saveError: null });
        return { ok: true, remote: false };
      }

      setSave({ saving: true, saveError: null });
      try {
        const profile = await api(ENDPOINTS.profile, { method: 'PUT', body: { country } });
        setState((previous) => ({
          ...previous,
          profile: profile ?? { ...previous.profile, country },
        }));
        setSave({ saving: false, saveError: null });
        return { ok: true, remote: true };
      } catch (error) {
        const apiError = error instanceof ApiError ? error : null;
        setSave({ saving: false, saveError: apiError });
        return { ok: false, error: apiError };
      }
    },
    [state.profile],
  );

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return {
    ...state,
    save,
    ...save_,
    reload,
  };
}

/**
 * `useKyc` lived here. It is `useKycStatus` in `queries/account.js` now.
 *
 * Phase 6 added `POST /user/kyc/submit`, and the mutation for it invalidates
 * the status read. This hook was a hand-rolled `useEffect` fetch holding
 * nothing in the query cache, so that invalidation would have matched zero
 * queries and done nothing — silently, leaving the identity card advertising
 * "Start verification" for documents already sitting in the review queue.
 *
 * The rest of this file stays as it is. `useProfile` has no mutation beside
 * it reaching into a cache, so there is nothing to fix and a rewrite would be
 * churn — see the note at the top of `queries/account.js`.
 */
