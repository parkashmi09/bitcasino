import { NavLink } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { HEADER_CONTROL } from './HeaderMenu';
import { cn } from '@/lib/cn';

/**
 * `Recents` in the signed-in header.
 *
 * It is a LINK, not a menu. That is what the reference has: read from its own
 * header, the control is `<a href="/games/recent">` at 113x40, and the sidebar
 * chip beside the favourites star points at the same place. This file replaces
 * `RecentsMenu.jsx`, which opened a 320px dropdown listing the same games —
 * the reference has no recents dropdown anywhere, and that panel is why the
 * two behaved nothing alike. The page behind it is `pages/Recent.jsx`.
 *
 * Not `HeaderIconLink`: that is the 40px square the bell and the profile
 * button use. This one is labelled — the reference writes "Recents" out at
 * 14px beside an 18px history glyph, in a 113x40 pill on the same translucent
 * `hit` as the two icon buttons next to it.
 *
 * `hidden xl:block` on the reference, so `max-xl:hidden` here: below 1200px
 * the row is the wallet and the two icons.
 */
export function RecentsLink({ className }) {
  return (
    <NavLink
      to="/games/recent"
      className={cn(HEADER_CONTROL, 'gap-2 px-4 text-sm font-medium', className)}
    >
      <Icon name="history" size={18} />
      Recents
    </NavLink>
  );
}
