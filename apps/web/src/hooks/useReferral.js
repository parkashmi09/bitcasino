import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ENDPOINTS } from '@/lib/endpoints';
import { useAuth } from '@/auth/AuthProvider';

/**
 * Everything `/profile/refer-a-friend` reads: the account's own referral code,
 * how many people have joined under it, and what those referrals have paid.
 *
 * All three are real, which is unusual for a page in this project — the
 * platform in `backend/` has a referral programme even though it has no bonus
 * or loyalty service:
 *
 *   `GET /user/profile/referral`   `{referralCode, referralLink}`
 *   `GET /user/affiliate/team`     `{referralCode, total, members[]}`
 *   `GET /user/affiliate/rewards`  `{total, totalAmount, rows[]}`
 *
 * `total` off `team` is the page's **Total Referrals**; `totalAmount` off
 * `rewards` is its **Total earned**, and it arrives as a decimal STRING summed
 * by Postgres over every matching row rather than by JavaScript over one page.
 * It is passed through to the DOM as the string it is — parsing it into a
 * `Number` to print it is the bug the backend's own comment describes on the
 * legacy route it replaced.
 *
 * ## The three calls are one state, not three
 *
 * A page that renders its link before its counters, or its counters before its
 * link, flickers twice on every visit. `Promise.allSettled` lands them
 * together, and *settled* rather than `all` because the three fail
 * independently: an account with no code at all answers `NO_REFERRAL_CODE` on
 * the first and empty on the other two, and a 404 on the affiliate pair should
 * still leave the invite link on screen. Whatever arrives is used; whatever
 * does not falls back to a zero the page can render.
 *
 * ## The invite link is built here, not taken from the API
 *
 * `referralLink` off the platform is `${PUBLIC_SITE_URL}/referal/${code}` —
 * the backend's own origin and the backend's own spelling, neither of which is
 * where this app is served from. So the code is what is used, and the link is
 * built against `window.location.origin` as `/ref/<code>`, which `App.jsx`
 * redirects into `/register?ref=<code>` — the parameter `SignUp` already reads
 * and resolves. That makes the link on this page one a friend can actually
 * open, on whatever host the app is running on.
 */
export function useReferral() {
  const { user } = useAuth();
  const [state, setState] = useState({
    code: null,
    referrals: 0,
    earned: '0',
    status: 'idle',
  });

  useEffect(() => {
    if (!user) return undefined;

    const controller = new AbortController();
    setState((current) => ({ ...current, status: 'loading' }));

    const get = (path) => api(path, { signal: controller.signal });

    Promise.allSettled([
      get(ENDPOINTS.profileReferral),
      get(ENDPOINTS.affiliateTeam),
      get(ENDPOINTS.affiliateRewards),
    ])
      .then(([referral, team, rewards]) => {
        if (controller.signal.aborted) return;

        const value = (result) => (result.status === 'fulfilled' ? result.value : null);
        const code =
          value(referral)?.referralCode ?? value(team)?.referralCode ?? null;

        setState({
          code,
          referrals: Number(value(team)?.total ?? 0),
          // A string, deliberately — see above.
          earned: String(value(rewards)?.totalAmount ?? '0'),
          status: 'ready',
        });
      })
      .catch(() => {
        // `allSettled` does not reject, so this only fires if the abort races
        // the resolution. Nothing to report either way.
      });

    return () => controller.abort();
  }, [user]);

  return {
    ...state,
    link: state.code ? inviteLink(state.code) : null,
  };
}

/**
 * `https://host/ref/CODE`.
 *
 * Built off `location.origin` rather than a configured base URL: this app is
 * served from wherever it is served from, and a link printed for the player to
 * send is the one place a wrong origin is unrecoverable — they will have sent
 * it before anyone notices.
 */
export function inviteLink(code) {
  const origin =
    typeof window === 'undefined' ? '' : window.location.origin.replace(/\/+$/, '');
  return `${origin}/ref/${code}`;
}
