import { createContext, useContext, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { ENDPOINTS } from '@/lib/endpoints';
import { ALL_ON, gateOf, makeGates } from '@/lib/gates';
import { useAuth } from '@/auth/AuthProvider';
import { useBranding, useSiteConfig } from '@/queries/siteConfig';
import { applyBranding } from '@/lib/branding';
import { applyCustomPalette } from '@/lib/customPalette';
import { DEFAULT_THEME, applyTheme, readStoredTheme } from '@/lib/theme';
import { useLanguageGuard } from '@/lib/i18n';
import { subscribe } from '@/lib/socket';
import { queryKeys } from '@/queries/keys';
import { refreshBalances } from '@/hooks/useWallet';

/**
 * The owner's plan, the site admin's switches and the player's capabilities,
 * read once at the root and shared (`lib/gates.js`). Outside the provider
 * everything is on.
 *
 * Also the route guard: a direct visit to a switched-off section goes to `/`
 * once every read that could switch it has answered.
 */
const GatesContext = createContext(ALL_ON);

/** Backend content scope → first element of the query keys that show it (`queries/keys.js`). */
const GAMES = ['games', 'providers', 'lobby-category', 'lobby-categories', 'in-house-games'];
const CONTENT_KEYS = {
  'admin:banners': ['content'],
  'admin:blogs': ['content'],
  'admin:promotions': ['promotions'],
  'admin:branding': ['site'],
  'admin:vip-branding': ['rewards'],
  'admin:original-games': GAMES,
  'casino:games': GAMES,
  'casino:catalogue': GAMES,
  'casino:gis': GAMES,
  'casino:original-games': GAMES,
  'casino:challenges': ['promotions'],
  'user:race': ['promotions'],
  'user:bonus': ['promotions', 'rewards'],
  'user:spin-wheel': ['promotions'],
  'user:reload-rewards': ['rewards'],
};

/** `{ ready, on(gate), routeOn(href), can(cap), policy(key), flag(key), agentPlayer, canSignUp() }` */
export function useGates() {
  return useContext(GatesContext);
}

export function GatesProvider({ children }) {
  const { user, status, refreshUser } = useAuth();
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
  // An owner-made theme (`custom_*`) has no CSS block: its colours ride on the row and go inline.
  const themeRow = Array.isArray(features.data) ? features.data.find((f) => f.feature === 'theme') : undefined;
  const palette = Array.isArray(features.data) ? value.policy('theme') : undefined;
  const customColours = themeRow?.palette;
  useEffect(() => {
    if (palette) document.documentElement.dataset.palette = palette;
    return applyCustomPalette(customColours);
  }, [palette, customColours]);

  // No toggle (theme_mode not 'switch'): everyone sees the site default, whatever was stored under 'switch'.
  const themeMode = ready ? value.themeMode() : null;
  useEffect(() => {
    if (themeMode && themeMode !== 'switch') applyTheme(DEFAULT_THEME, false);
    else if (themeMode === 'switch') applyTheme(readStoredTheme(), false);
  }, [themeMode]);

  // Off a language the owner switched off (owner panel → languages).
  useLanguageGuard();

  // The owner's name, title, meta and favicon (owner panel → Branding).
  const branding = useBranding();
  useEffect(() => applyBranding(branding), [branding]);

  // An admin or owner save pushes these to every player socket: re-read flags, plan and branding
  // now instead of waiting out the hour-long staleTime (hash `services/realtime.js` PUSHES).
  const queryClient = useQueryClient();
  useEffect(() => {
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.site.all });
      refreshUser?.();
    };
    // An admin content save pushes `contentUpdated {scopes}` (backend common/contentPush.js): re-read
    // what is on screen for those modules. A coin switched on/off changes which balances answer.
    const onContent = (payload) => {
      const prefixes = new Set((payload?.scopes ?? []).flatMap((scope) => CONTENT_KEYS[scope] ?? []));
      if (prefixes.size) queryClient.invalidateQueries({ predicate: (q) => prefixes.has(q.queryKey[0]) });
    };
    const offs = [
      ...['siteConfigUpdated', 'featuresUpdated'].map((event) => subscribe(event, refresh)),
      subscribe('contentUpdated', onContent),
      subscribe('currenciesUpdated', () => { refresh(); refreshBalances(); }),
    ];
    return () => offs.forEach((off) => off());
  }, [queryClient, refreshUser]);

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
