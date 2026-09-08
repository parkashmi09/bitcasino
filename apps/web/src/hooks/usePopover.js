import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The dismissal behaviour every header dropdown shares.
 *
 * Four of them hang off the top bar — wallet, recents, notifications, account
 * — and each one has to close on a click outside, on Escape, and when another
 * one opens. The third falls out of the first for free: `pointerdown` fires
 * before `click`, so pressing a second trigger closes the open panel on the
 * way down and opens its own on the way up. That only works while every panel
 * listens on `pointerdown` rather than `click`, which is the reason this is one
 * hook rather than four copies drifting apart.
 *
 * Escape is bound to the document, not the panel: focus is usually still on the
 * trigger, and a listener on the panel would never see the key.
 *
 * Usage: spread `ref` on the element that wraps BOTH the trigger and the panel,
 * or the trigger's own click will read as an outside press and re-close what it
 * just opened.
 */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => event.key === 'Escape' && setOpen(false);

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = useCallback(() => setOpen((value) => !value), []);
  const close = useCallback(() => setOpen(false), []);

  return { open, setOpen, toggle, close, ref };
}
