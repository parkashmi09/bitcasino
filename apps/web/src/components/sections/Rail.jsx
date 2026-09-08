import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';

/**
 * Shell shared by every horizontal row on the page.
 *
 * The reference site uses one chrome for all of them — game rails and
 * testimonials alike: a 32px header line carrying the title and a "See all"
 * link, a 20px gap, then the scroller. Keeping that in one place is what stops
 * the two from drifting apart.
 *
 * Scrolling is native (CSS scroll-snap) so touch and trackpad behave normally.
 * The paging controls are circular buttons floated over the ends of the row —
 * the reference only shows the one you can actually use, and hides both while
 * the row fits, which keeps quiet rails visually silent.
 *
 * `headingClassName` is the one escape hatch, and it exists for exactly one
 * caller. The tournaments page runs the same chrome under a page `h1`, so its
 * rail titles are subheadings there — 18px `trunks` rather than the 24px
 * display `bulma` a lobby rail uses. That is a type change, not a structural
 * one, so it is a class override rather than a second component; `cn` is
 * `twMerge`, so what is passed genuinely replaces the defaults instead of
 * fighting them. The element stays an `h2` either way, which the reference's
 * own `<span>` is not — a section under a heading should be one.
 */
export function Rail({ title, href, children, className, headingClassName }) {
  const railRef = useRef(null);
  const [canScroll, setCanScroll] = useState({ start: false, end: false });

  const sync = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    // Math.abs keeps this correct under RTL, where scrollLeft goes negative.
    const offset = Math.abs(el.scrollLeft);
    const max = el.scrollWidth - el.clientWidth;
    setCanScroll({ start: offset > 8, end: offset < max - 8 });
  }, []);

  useEffect(() => {
    sync();
    const el = railRef.current;
    if (!el) return;
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, [sync, children]);

  const page = (direction) => {
    const el = railRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: 'smooth' });
  };

  return (
    <section className={cn('flex flex-col gap-5', className)}>
      <div className="grid grid-flow-col items-center justify-between gap-4">
        <h2
          className={cn(
            'font-secondary text-xl font-light leading-8 text-bulma md:text-2xl',
            headingClassName,
          )}
        >
          {title}
        </h2>
        <Link
          to={href}
          className="flex min-h-6 shrink-0 items-center text-sm text-bulma underline underline-offset-2 hover:text-piccolo"
        >
          See all
        </Link>
      </div>

      <div className="relative">
        <div ref={railRef} onScroll={sync} className="rail gap-3">
          {children}
        </div>

        {[-1, 1].map((direction) => {
          const enabled = direction === -1 ? canScroll.start : canScroll.end;
          return (
            <button
              key={direction}
              type="button"
              onClick={() => page(direction)}
              tabIndex={enabled ? 0 : -1}
              aria-hidden={!enabled}
              aria-label={
                direction === -1 ? `Scroll ${title} left` : `Scroll ${title} right`
              }
              className={cn(
                'absolute top-1/2 z-10 hidden size-8 -translate-y-1/2 place-items-center',
                'rounded-full bg-goku text-bulma shadow-[0_2px_10px_rgba(0,0,0,0.18)]',
                'transition-opacity hover:bg-gohan md:grid',
                direction === -1 ? '-start-3' : '-end-3',
                enabled ? 'opacity-100' : 'pointer-events-none opacity-0',
              )}
            >
              <Icon
                name={direction === -1 ? 'chevron-left' : 'chevron-right'}
                size={18}
              />
            </button>
          );
        })}
      </div>
    </section>
  );
}
