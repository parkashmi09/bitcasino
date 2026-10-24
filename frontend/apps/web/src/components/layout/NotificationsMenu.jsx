import { NavLink } from 'react-router-dom';
import { HeaderIconLink } from './HeaderMenu';
import { useNotifications } from '@/hooks/useNotifications';

/**
 * The bell.
 *
 * It is a LINK, not a menu. That is what the reference has: read from its own
 * header, the control is `<a href="/profile/notifications">` wrapping the same
 * 40px square the profile button uses, and pressing it navigates to a page
 * rather than opening a panel. This file used to open a dropdown with an empty
 * state in it, which is why the two looked nothing alike — the reference has
 * no notification dropdown anywhere.
 *
 * The page is `pages/Notifications.jsx`; the tab bar over it is
 * `pages/ProfileLayout.jsx`.
 *
 * ## The pip
 *
 * It is back, and now it is true. It was left off while this project had no
 * feed at all, because a permanent pip that opens "You're all caught up" is a
 * claim that something is waiting when nothing is. `useNotifications` counts
 * unread rows and remembers what has been read, so the pip lights only when
 * there is something to see and goes out for good on `Mark all as read`.
 */
export function NotificationsMenu({ className }) {
  const { unread } = useNotifications();

  return (
    <HeaderIconLink
      as={NavLink}
      to="/profile/notifications"
      icon="bell"
      label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
      dot={unread > 0}
      className={className}
    />
  );
}
