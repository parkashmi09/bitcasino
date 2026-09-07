import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { cn } from '@/lib/cn';

/**
 * Top-of-page loading bar, shown on every internal navigation.
 *
 * The reference runs NProgress with its stock stylesheet and the brand colour
 * swapped in — read straight off the live site:
 *
 *   #nprogress .bar  { position: fixed; top: 0; left: 0; width: 100%;
 *                      height: 3px; background: rgb(var(--piccolo));
 *                      z-index: 1600 }
 *   #nprogress .peg  { position: absolute; right: 0; width: 100px;
 *                      height: 100%; box-shadow: 0 0 10px, 0 0 5px;
 *                      transform: rotate(3deg) translate(0, -4px) }
 *   #nprogress .spinner-icon { 18px, 2px border, top + left in brand,
 *                      border-radius: 50%, spin 400ms linear infinite }
 *
 * There is not a media query in it, and both pieces are fixed to the viewport,
 * so a phone gets exactly what a desktop does — hence no breakpoints below.
 *
 * The motion is the reference's too: the bar mounts at -100%, slides to 8%
 * over 200ms, creeps forward in small random steps that shrink as it fills,
 * then on arrival runs to 100% over 200ms and fades out over another 200ms
 * before unmounting.
 *
 * `FLOOR_MS` is ours. The reference is Next.js, so a route change waits on an
 * RSC payload and the bar has something real to measure; this is a Vite SPA
 * with every route in one bundle, so navigation is synchronous and the bar
 * would otherwise mount and complete inside a single frame. The floor holds it
 * on screen long enough to read as the same control. It delays nothing — the
 * new page is already painted underneath it.
 */

/** NProgress's own starting value: the bar never shows an empty track. */
const MINIMUM = 0.08;

/** Bar transition and fade, both 200ms on the reference. */
const SPEED = 200;

/** Gap between creep steps. */
const TRICKLE_MS = 300;

/** How long the bar runs before it is allowed to complete. See above. */
const FLOOR_MS = 500;

/** Small, decelerating steps — the reference creeps rather than jumps. */
const creep = (n) => Math.min(n + (1 - n) * (0.005 + Math.random() * 0.02), 0.994);

export function RouteProgress() {
  const { pathname, search } = useLocation();
  // `null` when idle, otherwise 0–1. Rendering is driven entirely by this.
  const [progress, setProgress] = useState(null);
  const [fading, setFading] = useState(false);
  const firstRender = useRef(true);

  useEffect(() => {
    // Nothing was navigated *to* on the first paint — a hard load has the
    // browser's own progress UI, and the reference does not double it.
    if (firstRender.current) {
      firstRender.current = false;
      return undefined;
    }

    const timers = [];
    setFading(false);
    setProgress(0);

    // A frame at -100% first, so the slide-in actually animates.
    const frame = requestAnimationFrame(() => setProgress(MINIMUM));

    const trickle = setInterval(
      () => setProgress((n) => (n === null ? n : creep(n))),
      TRICKLE_MS,
    );

    timers.push(
      setTimeout(() => {
        clearInterval(trickle);
        setProgress(1);
        timers.push(setTimeout(() => setFading(true), SPEED));
        timers.push(
          setTimeout(() => {
            setProgress(null);
            setFading(false);
          }, SPEED * 2),
        );
      }, FLOOR_MS),
    );

    // A navigation that lands mid-run restarts the bar rather than stacking
    // a second one, because this tears the whole sequence down first.
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(trickle);
      timers.forEach(clearTimeout);
    };
  }, [pathname, search]);

  if (progress === null) return null;

  // The fade is applied per element rather than to a wrapper on purpose: an
  // opacity below 1 makes an ancestor the containing block for its fixed
  // descendants, which would drop both of these to the top of the *document*
  // mid-fade on a scrolled page.
  const fade = {
    opacity: fading ? 0 : 1,
    transition: `opacity ${SPEED}ms linear`,
  };

  return (
    <div aria-hidden="true" className="pointer-events-none">
      <div
        style={{
          ...fade,
          transform: `translate3d(${(progress - 1) * 100}%, 0, 0)`,
          transition: `transform ${SPEED}ms, opacity ${SPEED}ms linear`,
        }}
        className="fixed inset-x-0 top-0 z-[1600] h-[3px] bg-piccolo"
      >
        {/* The glow that trails the leading edge. */}
        <span
          className="absolute end-0 block h-full w-[100px]"
          style={{
            // Inline rather than a `shadow-[…]` utility: Tailwind routes those
            // through its own shadow variables and drops a two-layer value.
            boxShadow: '0 0 10px rgb(var(--piccolo)), 0 0 5px rgb(var(--piccolo))',
            transform: 'rotate(3deg) translate(0, -4px)',
          }}
        />
      </div>

      <span
        style={fade}
        className={cn(
          'fixed end-[15px] top-[15px] z-[1600] block size-[18px] rounded-full',
          'border-2 border-transparent border-t-piccolo border-s-piccolo',
          'animate-[bc-spin_0.4s_linear_infinite]',
        )}
      />
    </div>
  );
}
