import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ENDPOINTS } from '@/lib/endpoints';
import { toSiteConfig } from '@/data/adapters';
import { queryKeys } from './keys';

/**
 * The public feature flags.
 *
 * ## This hook never has a loading state worth rendering
 *
 * `useSiteConfig()` returns a usable config object immediately, before the
 * request resolves, with every flag reading ON. That is not a shortcut — it is
 * the behaviour the backend itself has for an unconfigured deployment, and
 * matching it is what stops the home page assembling itself in front of the
 * player.
 *
 * The failure case defaults the same way, and that is the deliberate choice
 * here: if the config request fails, the site renders EVERYTHING rather than
 * nothing. A flag is an operator hiding a section; losing the answer should
 * not hide the whole site. Anything that must be off when unknown — a
 * compliance geo-block, say — does not belong in this flag set.
 *
 * ## What it is for
 *
 * Which home sections render (`home_*`), which currencies the picker offers,
 * and which top-level features exist. The sportsbook flag is deliberately NOT
 * in the public set — it is a kill switch with its own route — which is fine
 * here because this UI has no sports surface to gate.
 */

/** The shape returned before the first response arrives. Every flag ON. */
const PENDING_CONFIG = toSiteConfig(null);

export function useSiteConfig() {
  const query = useQuery({
    queryKey: queryKeys.site.config(),
    queryFn: ({ signal }) => api(ENDPOINTS.siteConfig, { auth: false, signal }),
    select: toSiteConfig,
    /**
     * Flags change when an operator saves the admin screen — rare, and never
     * mid-session in a way a player must see immediately. An hour of freshness
     * means this is one request per session rather than one per navigation.
     */
    staleTime: 60 * 60 * 1000,
    /**
     * Public and rate-limited. A retry storm here would meter the whole
     * origin, and the fallback (everything ON) is already the correct answer
     * for an unconfigured deployment — so it fails quietly and once.
     */
    retry: 1,
  });

  return {
    /** Always present. See the note above — there is no undefined state. */
    config: query.data ?? PENDING_CONFIG,
    /** For a staff-facing screen that wants to say the flags are provisional. */
    isPending: query.isPending,
    isError: query.isError,
    error: query.error ?? null,
  };
}
