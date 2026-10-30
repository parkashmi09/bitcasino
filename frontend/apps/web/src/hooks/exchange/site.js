/* bitcasino: the exchange's React glue — hash-game-exchange's context/session, context/gates and
 * hooks/useMediaQuery, answered from this app's AuthProvider, GatesProvider and media query hook. */
import { useAuth } from '@/auth/AuthProvider';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { tokenStore } from '@/auth/tokenStore';

export { useGates } from '@/hooks/useGates';

export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)');

/**
 * hash's `useSession()` as the exchange reads it: `session.login` and `session.userId` (the platform
 * user id mssports keys its accounts on). `exposure` is the sports exposure the hash header carried;
 * this site's header has none, so the open-bets panel reads its own (null = not shown).
 */
export function useSession() {
  const { user, status } = useAuth();
  const login = status === 'authenticated' && Boolean(tokenStore.getAccess());
  return { session: { login, userId: login ? (user?.id ?? null) : null }, exposure: null };
}
