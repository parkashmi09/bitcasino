import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';

/**
 * The pieces the signed-in header's four controls are built from.
 *
 * They exist as one module because the reference draws the cluster as a set,
 * not as four unrelated controls. Every number below was measured off
 * bitcasino.io's own signed-in header rather than guessed — see
 * `docs/11-comparing-against-the-reference.md` for how to re-read them:
 *
 *   trigger height   40px      (`h-10`, NOT the 44px the page's buttons use)
 *   radius           12px      (`rounded-i-md`)
 *   resting fill     hit @ 30% (`bg-hit/30`) — no border
 *   icon             18px
 *   gap between      6px       (`gap-1.5`)
 *   panel offset     8px below the trigger
 *
 * `usePopover` supplies the behaviour — see `hooks/usePopover.js`.
 */

/**
 * The shared trigger shell: 40px tall, 12px corners, translucent `hit`.
 *
 * The transparent border is the same trick `Button.jsx` already documents —
 * every control on the reference carries one so a filled and an outlined
 * control of the same size occupy the same box. It is load-bearing on the one
 * trigger here that is not a fixed square: without it `Recents` measures 111px
 * against the reference's 113.
 */
export const HEADER_CONTROL = cn(
  'inline-flex h-10 shrink-0 cursor-pointer items-center justify-center',
  'rounded-i-md border border-transparent bg-hit/30 text-bulma',
  'transition-colors hover:bg-hit',
);

/** A 40px square menu trigger. `dot` paints the unread pip — see `HeaderDot`. */
export function HeaderIconButton({ icon, label, open, dot = false, className, ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={open}
      className={cn(HEADER_CONTROL, 'relative w-10', open && 'bg-hit', className)}
      {...props}
    >
      <Icon name={icon} size={18} />
      {dot && <HeaderDot />}
    </button>
  );
}

/**
 * The same square, as a link.
 *
 * Not every control in this cluster is a menu. The reference's bell is an
 * `<a href="/profile/notifications">` and its `Recents` an
 * `<a href="/games/recent">` — read from its own header — so a trigger that
 * navigates needs the identical box without the `aria-haspopup`/`aria-expanded`
 * a menu button carries, and with `aria-current` when it is the page you are on.
 *
 * `as` is the same escape hatch `Button.jsx` uses, so the caller passes
 * `NavLink` and this file does not import the router.
 */
export function HeaderIconLink({ as: As = 'a', icon, label, dot = false, className, ...props }) {
  return (
    <As
      aria-label={label}
      className={cn(HEADER_CONTROL, 'relative w-10', className)}
      {...props}
    >
      <Icon name={icon} size={18} />
      {dot && <HeaderDot />}
    </As>
  );
}

/**
 * The reference's unread pip: 8px, `piccolo`, ringed with the page background
 * so it stays legible where it overlaps the glyph, and pinned to the ICON's
 * top-right corner rather than the control's — which on a 40px box holding an
 * 18px glyph is 11px in from each edge.
 */
function HeaderDot() {
  return (
    <span
      aria-hidden="true"
      className="absolute end-[11px] top-[11px] size-2 rounded-full border border-goku bg-piccolo"
    />
  );
}

/**
 * The dropdown surface. Anchored to the end of its trigger and 8px below it,
 * which is where the `translateY(-4px)` in `animate-menu-in` starts from. In a
 * 64px header holding a 40px trigger that lands the panel at y=60, which is
 * exactly where the reference's sits.
 *
 * `max-h` plus its own scroller: the recents list can outgrow the viewport on
 * a short window, and a panel that runs off the bottom of the screen has no
 * way back.
 *
 * ## `sheet`
 *
 * The reference's account menu is a floating 288px card on a laptop and a
 * FULL-BLEED sheet hanging off the header on a phone. That is its own class
 * list, read verbatim off their DOM: `w-72 rounded-lg bg-background
 * max-sm:w-screen max-sm:rounded-t-none`. `sheet` is that second form.
 *
 * It is not the account menu's alone. Any panel with a FIXED width has to take
 * it, because these panels are anchored `end-0` to their own trigger and the
 * wallet's trigger sits in the header's MIDDLE slot: a 300px card anchored to
 * the end of a control that ends at x=180 starts at x=-120. That is not a card
 * that overhangs a little, it is a card whose left two thirds are off the
 * screen — measured at -162 on a 215px viewport before the wallet took this
 * variant. `absolute` cannot clamp itself, so the fix is the form that does
 * not need to: full-bleed below `sm`, the card from `sm` up.
 *
 * A caller that wants its own scroller inside the sheet — the wallet again,
 * whose currency list scrolls under a pinned footer — passes `flex flex-col`
 * and `overflow-y-hidden`, the second of which is what takes the panel's own
 * `overflow-y-auto` back off through `twMerge`.
 *
 * A sheet brings NO radius of its own; each caller passes its two — square top
 * corners with `rounded-b-*` below `sm`, the full `sm:rounded-*` above it. Not
 * a default worth having, because it cannot be overridden: `tailwind-merge`
 * knows nothing about this project's `i-` radius scale, so it keeps both
 * `sm:rounded-i-sm` and a caller's `sm:rounded-i-md` and leaves the stylesheet's
 * emit order to pick — which silently gave the wallet the account menu's 8px.
 *
 * It is written mobile-first — full width by default, floating from `sm` up —
 * rather than as `max-sm:` overrides on the floating form. Both would work,
 * but the overriding version leaves two unprefixed-vs-`max-sm:` `top` values
 * on one element with nothing but Tailwind's emit order deciding between them,
 * and the losing one resolves `calc(100% + 8px)` against the VIEWPORT once the
 * panel is `fixed` — i.e. the sheet lands a screen height below the fold. One
 * ternary is cheaper than that failure mode.
 *
 * `fixed` works from inside the header because a `sticky` ancestor does not
 * establish a containing block for fixed positioning, so the sheet measures
 * against the viewport and escapes the header's own `px-4`. `dvh`, not `vh`,
 * so it does not run under a phone browser's collapsing address bar.
 *
 * The `100dvh - 60px` cap is the panel's own top offset subtracted from the
 * viewport, and it holds at EVERY width — the floating form keeps it too. That
 * is what Radix hands the reference as `--radix-dropdown-menu-content-
 * available-height`, and it measured 669.6px in a 730px window. The `70vh`
 * cap the other panels use would put a scrollbar on a nine-row menu that fits.
 */
export function MenuPanel({ label, className, sheet = false, children }) {
  return (
    <div
      role="menu"
      aria-label={label}
      className={cn(
        'animate-menu-in z-50 origin-top-right overflow-hidden',
        'border-[0.8px] border-beerus bg-goku shadow-lg',
        sheet
          ? cn(
              'fixed inset-x-0 top-[60px] max-h-[calc(100dvh-60px)]',
              'sm:absolute sm:inset-x-auto sm:end-0 sm:top-[calc(100%+8px)]',
            )
          : 'absolute end-0 top-[calc(100%+8px)] max-h-[min(70vh,32rem)] rounded-i-md',
        'overflow-y-auto',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * The title row every panel opens with — a heading, optionally an action.
 *
 * `shrink-0` is for the one panel that is a flex column with a scroller in the
 * middle of it — the wallet's. A 48px band whose height comes from a class
 * rather than from its content is otherwise squeezed by the overflowing list
 * beside it; the panels that are not flex containers never read the property.
 */
export function MenuHeading({ children, action }) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-2 px-4">
      <h2 className="font-primary text-sm font-semibold text-bulma">{children}</h2>
      {action}
    </div>
  );
}

/**
 * What a panel shows with nothing in it. The glyph is the panel's own icon at
 * 28px inside a `gohan` disc — the reference's empty states are drawn from the
 * same icon rather than from a separate illustration.
 */
export function MenuEmpty({ icon, title, children }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-gohan text-trunks">
        <Icon name={icon} size={28} />
      </span>
      <p className="text-sm font-medium text-bulma">{title}</p>
      {children && <p className="text-xs leading-relaxed text-trunks">{children}</p>}
    </div>
  );
}

/**
 * The hairline between a panel's sections. `className` is for the account
 * panel, whose 4px gutter means its rule has to bleed back out to the panel
 * edge (`-mx-1`) instead of stopping short of it.
 */
export function MenuDivider({ className }) {
  return <hr className={cn('h-px shrink-0 border-0 bg-beerus', className)} />;
}
