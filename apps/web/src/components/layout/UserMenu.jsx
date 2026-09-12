import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { NavIcon } from '@/components/ui/NavIcon';
import { Skeleton } from '@/components/ui/Skeleton';
import { HeaderIconButton, MenuDivider, MenuPanel } from './HeaderMenu';
import { usePopover } from '@/hooks/usePopover';
import { useAuth } from '@/auth/AuthProvider';
import { ASSETS } from '@/data/assets.generated';
import { LOYALTY } from '@/data/loyalty';
import { cn } from '@/lib/cn';

/**
 * The account end of the signed-in cluster: the profile trigger and the panel
 * behind it.
 *
 * The trigger is a plain 40px icon button, identical to the bell beside it.
 * That is what the reference has — read from its own header, the control is a
 * 40x40 `rounded-xl` button holding a 16px outline person, with no avatar, no
 * name and no caret. An avatar chip with the account's initial and a chevron
 * is a different, wider control, and it was the loudest of the differences
 * against the real header.
 *
 * ## The panel, measured
 *
 * Every number below came off bitcasino.io's own account menu with the panel
 * open — `getBoundingClientRect` and `getComputedStyle` on each piece, the
 * procedure in `docs/11-comparing-against-the-reference.md`. It is not the
 * same chrome as the Recents and notification panels beside it, which is why
 * `MenuPanel`'s defaults are overridden here rather than changed for everyone:
 *
 *   width            288px      (`w-72`)
 *   radius           8px        (`rounded-i-sm`, NOT the 12px of the triggers)
 *   padding          4px        (`p-1`) — the rows carry the rest
 *   surface          goku, `shadow-md` over a 1px `bulma/10` ring, no border
 *   offset           8px below the trigger, i.e. y=60 in a 64px header
 *   greeting band    full width, `beerus`, 8px radius, 8px pad, 14px text
 *   loyalty card     `beerus`, 8px radius, 8px pad, 8px grid gap
 *     tile           44px wide, `goku`, 8px radius, holding a 32px emblem
 *     facts          `goku`, 8px radius, 12/8 pad, a 28x1 `beerus` rule between
 *     labels         10px `trunks` over 14px medium `bulma`
 *     progress       16px tall, `goku` track, `piccolo` fill inset 2px,
 *                    the `n / target` label centred over it at 12px
 *   rule             `-mx-1 my-1` hairline in `hit`
 *   row              40px tall, 8px radius, 10px pad, 12px gap,
 *                    20px icon, 14px medium label, `gohan` on hover
 *   badge            20px `piccolo` pill, 14px medium `goten`
 *
 * ## Mobile
 *
 * Below `sm` the reference's panel is a full-bleed sheet hanging off the
 * bottom of the header, not a 288px card floating over the page — square top
 * corners, rounded bottom ones, running to the bottom of the screen. That is
 * `MenuPanel`'s `sheet` variant, which is where the class list it was read
 * from is written down.
 *
 * ## What the rows can and cannot do
 *
 * The row list, its order and its artwork are the reference's — the icons are
 * the same `cms/icons` illustrations at the same 20px, through `NavIcon`, so
 * the panel is the same object rather than a monochrome sketch of it.
 *
 * Every row now has a route behind it. `Tournaments` was the last to get one
 * and, like `Loyalty`, it leaves the account area entirely — both go to a page
 * of their own rather than a `/profile` tab, which is where the reference
 * points them too.
 *
 * `MenuRow` still renders a row with no `to` as inert — painting exactly as the
 * reference draws it, with no hover fill and no tab stop. Nothing uses that
 * path today; it stays because it is the rule this project applies whenever a
 * destination is not built yet, and `docs/11` records it.
 *
 * The reference carries unread counts on `Rewards` and `Tournaments`. Nothing
 * here counts anything, and a badge over a number we invented is the same lie
 * as a permanent pip on the bell, so `MenuRow` takes a `badge` and no caller
 * passes one yet.
 *
 * The panel opens with `animate-menu-in` — the fade-and-95%-zoom every surface
 * on this site opens with, 150ms, from the corner it is anchored to. It does
 * not animate closed: React unmounts it on the same frame, and holding it
 * mounted for an exit the reference does not have would only make dismissal
 * feel slower.
 */

/**
 * The row list, in the reference's order. `icon` is a `NavIcon` name — the
 * same 20px full-colour CMS illustrations the sidebar nav uses, which is what
 * the reference draws here too. `to` is absent where we have no page.
 */
const ITEMS = [
  { label: 'Loyalty', icon: 'loyalty', to: '/loyalty' },
  { label: 'Rewards', icon: 'rewards', to: '/profile/rewards' },
  { label: 'Tournaments', icon: 'tournaments', to: '/tournaments' },
  { label: 'Boosts', icon: 'boosts', to: '/profile/boosts' },
  { label: 'Account', icon: 'account', to: '/profile/account' },
  { label: 'Security', icon: 'security', to: '/profile/security' },
  { label: 'Notifications', icon: 'notifications', to: '/profile/notifications' },
  { label: 'Refer a friend', icon: 'refer-a-friend', to: '/profile/refer-a-friend' },
];

export function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { open, toggle, setOpen, ref } = usePopover();
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  const name = user.name ?? 'Account';

  async function onLogout() {
    setBusy(true);
    try {
      await logout();
      setOpen(false);
      navigate('/', { replace: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={ref} className="relative">
      <HeaderIconButton icon="user" label="Account menu" open={open} onClick={toggle} />

      {open && (
        <MenuPanel
          label="Account"
          sheet
          className="border-0 p-1 shadow-md ring-1 ring-bulma/10 rounded-b-i-sm sm:w-72 sm:rounded-i-sm"
        >
          {/* The greeting band. `truncate` because a display name is free text
              and the panel is 288px wide. */}
          <div className="mb-1 truncate rounded-i-sm bg-beerus p-2 text-sm text-bulma">
            Hi, {name}
          </div>

          <LoyaltyCard />

          <MenuDivider className="-mx-1 my-1 bg-hit" />

          {ITEMS.map((item) => (
            <MenuRow key={item.label} {...item} onNavigate={() => setOpen(false)} />
          ))}

          <MenuRow
            icon="logout"
            label={busy ? 'Logging out…' : 'Log out'}
            onClick={onLogout}
            disabled={busy}
          />
        </MenuPanel>
      )}
    </div>
  );
}

/**
 * One row of the list. Three forms behind one shape: a link where the app has
 * the page, a button where it has an action, and an inert `aria-disabled` div
 * for the Phase 6 rows — which is a div rather than a `<button disabled>` so a
 * screen reader still announces the label instead of skipping it.
 *
 * **Every row paints the same.** The reference's rows are one colour — a
 * full-colour 20px icon beside a `bulma` label — and greying the seven that
 * have nowhere to go made a panel that reads as half broken rather than as
 * the reference's. So the unbuilt rows are told apart by what they DO, not by
 * how they look: `aria-disabled`, no hover fill, no cursor change, and no tab
 * stop. That distinction is real for a keyboard or a screen reader and costs
 * nothing visually.
 */
function MenuRow({ icon, label, to, badge, onClick, onNavigate, disabled }) {
  const shape = 'flex h-10 w-full items-center gap-3 rounded-i-sm px-2.5 text-start';
  const type = 'text-sm font-medium text-bulma';
  // Nothing to go to and nothing to do: a Phase 6 row.
  const inert = !to && !onClick;

  const body = (
    <>
      <NavIcon name={icon} size={20} />
      <span className="flex-1 truncate">{label}</span>
      {badge != null && (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-piccolo px-1 text-sm font-medium text-goten">
          {badge}
        </span>
      )}
    </>
  );

  if (inert) {
    return (
      <div role="menuitem" aria-disabled="true" className={cn(shape, type)}>
        {body}
      </div>
    );
  }

  if (to) {
    return (
      <NavLink
        to={to}
        role="menuitem"
        onClick={onNavigate}
        className={cn(shape, type, 'transition-colors hover:bg-gohan')}
      >
        {body}
      </NavLink>
    );
  }

  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={cn(shape, type, 'cursor-pointer transition-colors hover:bg-gohan disabled:opacity-60')}
    >
      {body}
    </button>
  );
}

/**
 * The card under the greeting: a tile, two facts and a progress bar, all on a
 * `beerus` ground with each piece cut back out of it in `goku`.
 *
 * The tile holds the TIER emblem, as on the reference — the entry tier's egg,
 * served from `images/ui`. Not the player's avatar: the reference's element
 * here is an avatar component, but the picture in it is the tier's, and a
 * profile picture in a loyalty card says the wrong thing.
 *
 * `LOYALTY` is fixed; see `data/loyalty.js` for why, and for the seam.
 */
function LoyaltyCard() {
  const { tier, multiplier, points, target } = LOYALTY;
  // Clamped, because a `points` past `target` would otherwise push the fill
  // out through the track's rounded end.
  const pct = target > 0 ? Math.min(100, Math.max(0, (points / target) * 100)) : 0;

  return (
    <div className="grid gap-2 rounded-i-sm bg-beerus p-2">
      <div className="flex items-stretch gap-2">
        <div className="flex w-11 items-center justify-center rounded-i-sm bg-goku px-1 py-1.5">
          <img
            src={ASSETS.ui.loyaltyBeginner}
            alt=""
            width={32}
            height={32}
            aria-hidden="true"
            className="size-8 shrink-0 object-contain"
          />
        </div>

        <div className="flex flex-1 items-center justify-between gap-2 rounded-i-sm bg-goku px-3 py-2">
          <Fact label="Loyalty tier">{tier}</Fact>
          <div aria-hidden="true" className="h-7 w-px shrink-0 bg-beerus" />
          <Fact label="Current multiplier">x {multiplier}</Fact>
        </div>
      </div>

      <div
        role="progressbar"
        aria-label="Loyalty progress"
        aria-valuenow={points}
        aria-valuemin={0}
        aria-valuemax={target}
        className="relative flex h-4 items-center justify-center overflow-hidden rounded-full bg-goku"
      >
        <div
          aria-hidden="true"
          className="absolute inset-y-0.5 start-0.5 rounded-full bg-piccolo"
          style={{ width: `calc(${pct}% - 4px)` }}
        />
        {/* Bare digits, no thousands separator — the reference writes
            `0 / 2800`, and a grouped `2,800` is wider than the 16px track has
            room for once the fill is under it. */}
        <span className="relative text-xs font-medium text-bulma">
          {points} / {target}
        </span>
      </div>
    </div>
  );
}

/** A 10px caption over a 14px medium value — the card's two facts. */
function Fact({ label, children }) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <span className="truncate text-[10px] leading-3 text-trunks">{label}</span>
      <span className="truncate text-sm font-medium text-bulma">{children}</span>
    </div>
  );
}

/**
 * What stands in the actions cluster's place while the stored refresh token is
 * being exchanged. Without it the header paints Login/Sign Up for one round
 * trip and then swaps them for the account controls — a flicker the reference
 * does not have, because it knows who you are before it renders anything.
 *
 * It covers the whole right-hand row rather than the profile button alone: all
 * three arrive on the same frame, and a skeleton the size of one of them would
 * let the other two shove the row sideways as they land. The wallet has its
 * own, in the header's middle slot — see `WalletMenuSkeleton`.
 */
export function UserMenuSkeleton() {
  return (
    <div className="flex items-center gap-1.5">
      <Skeleton className="h-10 w-[113px] rounded-i-md max-xl:hidden" />
      <Skeleton className="size-10 rounded-i-md" />
      <Skeleton className="size-10 rounded-i-md" />
    </div>
  );
}
