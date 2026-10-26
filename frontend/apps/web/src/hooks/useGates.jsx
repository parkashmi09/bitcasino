import { createContext, useContext, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { ENDPOINTS } from '@/lib/endpoints';
import { ALL_ON, gateOf, makeGates } from '@/lib/gates';
import { useAuth } from '@/auth/AuthProvider';
import { useSiteConfig } from '@/queries/siteConfig';
import { queryKeys } from '@/queries/keys';

/**
 * The owner's plan, the site admin's switches and the player's capabilities,
 * read once at the root and shared (`lib/gates.js`). Outside the provider
 * everything is on.
 *
 * Also the route guard: a direct visit to a switched-off section goes to `/`
 * once every read that could switch it has answered.
 */
const GatesContext = createContext(ALL_ON);

/** `{ ready, on(gate), routeOn(href), can(cap), policy(key), flag(key), agentPlayer, canSignUp() }` */
export function useGates() {
  return useContext(GatesContext);
}

export function GatesProvider({ children }) {
  const { user, status } = useAuth();
  const { config, isPending: flagsPending } = useSiteConfig();
  const features = useQuery({
    queryKey: queryKeys.site.features(),
    queryFn: ({ signal }) => api(ENDPOINTS.ownerFeatures, { auth: false, signal }),
    // The owner changes the plan rarely; a refocus re-read picks it up.
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  // `config.raw` is `{}` until the flags answer, which reads as all-on.
  const flags = flagsPending ? null : config.raw;
  const capabilities = status === 'authenticated' ? (user?.capabilities ?? null) : null;
  const ready = status !== 'loading' && !flagsPending && !features.isPending;

  const value = useMemo(
    () => makeGates({ flags, features: Array.isArray(features.data) ? features.data : null, capabilities, ready }),
    [flags, features.data, capabilities, ready],
  );

  // The owner's colour theme (styles/tokens.css [data-palette]); unset until the plan answers.
  const palette = Array.isArray(features.data) ? value.policy('theme') : undefined;
  useEffect(() => {
    if (palette) document.documentElement.dataset.palette = palette;
  }, [palette]);

  const { pathname } = useLocation();
  const navigate = useNavigate();
  const off = ready && !value.routeOn(pathname);
  useEffect(() => {
    if (off) navigate('/', { replace: true });
  }, [off, navigate]);

  return <GatesContext.Provider value={value}>{children}</GatesContext.Provider>;
}

/** Keeps a gated page unmounted while its section is off or not answered, so it never fires its reads. */
export function RouteGate({ children }) {
  const gates = useGates();
  const { pathname } = useLocation();
  if (!gateOf(pathname)) return children;
  if (!gates.ready || !gates.routeOn(pathname)) return null;
  return children;
}
