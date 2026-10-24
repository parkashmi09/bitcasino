import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { useOperatorNotice } from '@/queries';
import { cn } from '@/lib/cn';

/**
 * The operator's live banner — `admin_notify`.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * THIS IS THE ONE SURFACE IN THE APP THAT IS NOT PERSISTED ANYWHERE.
 *
 * `admin_notify` writes no row. A staff member sends it, every socket that is
 * connected AT THAT MOMENT receives it, and it exists nowhere afterwards —
 * not in a table, not in the notifications feed, not on a reload. So this is
 * deliberately a transient toast and deliberately NOT routed into
 * `useNotifications`: putting it in a list that survives a refresh would be
 * claiming a durability the platform does not provide, and the row would
 * vanish the next time that list was actually fetched.
 *
 * The durable path is `notifications.broadcast` in admin-service, which does
 * write a row and does push over FCM. That one surfaces through the bell.
 * This is the live banner for whoever happens to be looking.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ## It cannot be tested from this deployment
 *
 * Sending one needs a STAFF token, and staff login is blocked here by the 2FA
 * enrolment gate Phase 0 hit — so there is no way to trigger a broadcast
 * against this platform and watch it arrive. What is verified is the read
 * path: `queries/live.test.jsx` drives a frame through `subscribe` in both
 * spellings. The wire format itself is read from `social/sockets.js`, which
 * is the authority for it.
 */

/** Long enough to read a sentence, short enough not to sit over the page. */
const DISMISS_MS = 12_000;

export function OperatorNotice() {
  const [notice, setNotice] = useState(null);

  /**
   * One notice at a time, newest wins.
   *
   * A queue would be the obvious alternative and is wrong for this: an
   * operator broadcast is almost always a single urgent line — maintenance in
   * five minutes — and if two arrive close together the SECOND is the one
   * that matters. Stacking them would bury the correction under the thing it
   * corrects.
   */
  const onNotice = useCallback((next) => setNotice(next), []);
  useOperatorNotice(onNotice);

  /* Keyed on `notice.at` rather than on the object, so two identical notices
     sent a minute apart each get their own full dismissal window instead of
     the second one inheriting the first one's remaining time. */
  useEffect(() => {
    if (!notice) return undefined;
    const id = window.setTimeout(() => setNotice(null), DISMISS_MS);
    return () => window.clearTimeout(id);
  }, [notice?.at]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!notice) return null;

  return (
    <div
      /* `status`, not `alert`: an operator notice is informational, and
         `alert` interrupts a screen reader mid-sentence. `aria-live` is
         polite for the same reason. */
      role="status"
      aria-live="polite"
      className={cn(
        'animate-menu-in fixed inset-x-0 top-[72px] z-50 mx-auto flex w-[min(32rem,calc(100%-2rem))]',
        'items-start gap-3 rounded-i-md border-[0.8px] border-beerus bg-goku p-4 shadow-lg',
      )}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-krillin/15 text-krillin">
        <Icon name="alert" size={18} />
      </span>
      <p className="min-w-0 flex-1 break-words text-sm leading-relaxed text-bulma">
        {notice.text}
      </p>
      <button
        type="button"
        onClick={() => setNotice(null)}
        aria-label="Dismiss"
        className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-i-sm text-trunks transition-colors hover:bg-heles hover:text-bulma"
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
