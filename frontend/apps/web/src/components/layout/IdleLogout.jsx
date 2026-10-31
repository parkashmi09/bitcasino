import { useEffect } from 'react';

import { useAuth } from '@/auth/AuthProvider';
import { tokenStore } from '@/auth/tokenStore';
import { api } from '@/lib/api';
import { ENDPOINTS } from '@/lib/endpoints';
import { idleNotice, startIdleTracker } from '@/lib/idleTracker';
import { toast } from '@/lib/toast';
import { useSiteConfig } from '@/queries/siteConfig';

/**
 * Idle logout (lib/idleTracker.js) while signed in and while the site config has it on: signs the
 * player out like the Sign out button does, then says why in a toast. Renders nothing.
 */
export function IdleLogout() {
  const { status, logout } = useAuth();
  const minutes = useSiteConfig().raw.idleLogoutMinutes;
  const signedIn = status === 'authenticated';

  useEffect(() => {
    if (!signedIn || !minutes) return undefined;
    return startIdleTracker({
      minutes,
      ping: () => api(ENDPOINTS.authActivity, { method: 'POST' }),
      check: () => api(ENDPOINTS.idleCheck, { method: 'POST' }),
      hasSession: tokenStore.hasSession,
      onSignedOut: async () => {
        await logout().catch(() => {});
        toast.info(idleNotice(minutes));
      },
    });
  }, [signedIn, minutes, logout]);

  return null;
}
