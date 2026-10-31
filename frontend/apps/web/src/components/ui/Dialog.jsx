import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';

/**
 * The modal shell: overlay, panel, and the behaviour a dialog owes a keyboard.
 *
 * ## Why this exists now and not before
 *
 * `Security.jsx` carried a note saying the shell was written inline "because
 * the two differ in everything below the frame, and a `Dialog` abstraction
 * over two callers would be one indirection for no reuse; if a third lands,
 * extract it then." Phase 6 lands three more — two-factor setup, two-factor
 * disable, and the KYC submission — so it is extracted, and the change password
 * and claim reward dialogs move onto it. Five callers, one shell.
 *
 * What is shared is exactly the frame: the overlay, the panel box, the
 * heading row with its close button, and the four behaviours below. Everything
 * inside is the caller's, which is why this takes `children` and not a schema.
 *
 * ## The four behaviours, and why each is not optional
 *
 * **It stays mounted for one animation after `open` goes false.** React
 * unmounting the tree on the same tick cuts the zoom-out off halfway, so the
 * dialog vanishes rather than closing. `closing` is what holds it.
 *
 * **Escape closes it, and stops propagating.** Without `stopPropagation` an
 * Escape inside a dialog opened from a popover closes both, and the player
 * loses the thing behind the thing they were dismissing.
 *
 * **Focus returns to whatever opened it.** A dialog that closes leaving focus
 * on `<body>` sends the next Tab to the top of the document, which for a
 * keyboard user means finding their place again from the site header.
 *
 * **Body scroll is locked while it is up**, and the previous value restored
 * rather than cleared — clearing it would drop an `overflow` some other
 * component set and is how two overlapping locks leave the page unscrollable.
 *
 * ## What it deliberately does NOT do
 *
 * There is no focus trap. It would need a full tabbable-node walk to be
 * correct, and a half-built one that misses a control is worse than none —
 * it silently swallows Tab. `aria-modal` tells assistive technology the rest
 * of the page is inert, which is the part that actually helps; a keyboard
 * user can still Tab out, and Escape and the close button are both there.
 * Worth doing properly, not worth faking.
 */

/** Matches the dialog enter/leave animations in `styles/index.css`. */
const ANIMATION_MS = 150;

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {string} props.title       Also the accessible name.
 * @param {React.RefObject} [props.initialFocus] Focused on open — the first field.
 * @param {string} [props.width]     A max-width utility; the default is the 448px
 *                                   the reference uses for its account dialogs.
 * @param {string} [props.maxHeight] A max-height utility; the default lets the
 *                                   panel grow to the viewport. Callers with a
 *                                   long body cap it (the terms dialog uses the
 *                                   reference's own `md:max-h-[480px]`) and the
 *                                   panel scrolls internally.
 */
export function Dialog({
  open,
  onClose,
  title,
  initialFocus,
  width = 'max-w-[448px]',
  maxHeight = 'max-h-[calc(100dvh-2rem)]',
  children,
}) {
  const [closing, setClosing] = useState(false);
  const openerRef = useRef(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return undefined;

    openerRef.current = document.activeElement;
    setClosing(false);

    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    // A tick, so the panel is in the document before focus moves to it.
    const id = window.setTimeout(() => initialFocus?.current?.focus(), 0);

    return () => {
      window.clearTimeout(id);
      document.body.style.overflow = overflow;
    };
  }, [open, initialFocus]);

  const close = useCallback(() => {
    setClosing(true);
    window.setTimeout(() => {
      setClosing(false);
      onClose();
      openerRef.current?.focus?.();
    }, ANIMATION_MS);
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open && !closing) return null;

  const leaving = closing || !open;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        role="presentation"
        onClick={close}
        className={cn(
          'absolute inset-0 bg-popo/50',
          leaving ? 'animate-overlay-out' : 'animate-overlay-in',
        )}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'relative grid w-full gap-4 overflow-y-auto rounded-i-md bg-goku p-4',
          'shadow-lg ring-1 ring-bulma/10 outline-none',
          width,
          maxHeight,
          leaving ? 'animate-dialog-out' : 'animate-dialog-in',
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b-[0.5px] border-beerus pb-4">
          <h2
            id={titleId}
            className="font-primary text-lg leading-7 font-medium tracking-normal text-bulma"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="-me-1 -mt-1 grid size-8 shrink-0 cursor-pointer place-items-center rounded-i-sm text-bulma transition-colors hover:bg-heles"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        {children}
      </div>
    </div>
  );
}
