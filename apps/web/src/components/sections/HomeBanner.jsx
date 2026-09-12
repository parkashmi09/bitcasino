import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { HOME_BANNERS } from '@/data/catalog';
import { useBanners } from '@/queries';
import { cn } from '@/lib/cn';

/**
 * ═════════════════════════════════════════════════════════════════════════
 * WHY THE COPY IS STILL LOCAL, AND ONLY THE ART COMES FROM THE PLATFORM
 *
 * `docs/10`'s Phase 7 bullet says `GET /api/v1/admin/banners` "replaces the
 * hand-written `HOME_BANNERS` in `catalog.js`". It cannot. The row is:
 *
 *     (id, type, image, content_type, byte_size, uploaded_by, is_active, …)
 *
 * An image and a placement name. **There is no title, no blurb and no
 * destination anywhere in it**, and each of these three cards has all three.
 * So the platform can say which PICTURE a placement shows and nothing else.
 *
 * The split this file makes:
 *
 *   art     from `admin/banners` when a placement has one, else the local file
 *   copy    always local — the platform has nowhere to put it
 *   link    always local, for the same reason
 *
 * `banner.id` is the placement key, so uploading a banner of type
 * `banner-league` swaps the League card's artwork with no code change. That is
 * the whole of what the endpoint buys, and it is worth having: art is the part
 * an operator actually wants to change without a deploy.
 *
 * The table is **empty** on this deployment, which is the normal state where
 * nobody has uploaded anything — so the fixture art is what renders, and that
 * is not a fallback for a failure. Nothing is wrong.
 *
 * Giving the platform the copy too would need a migration adding
 * `title`, `subtitle` and `href` to `banners`, plus admin-panel fields for
 * them. Flagged in `docs/10` as backend work rather than faked here.
 * ═════════════════════════════════════════════════════════════════════════
 */

/** Copies of the banner set laid end to end, so there is always one either
 *  side of the one on screen. Three is the minimum that lets the carousel run
 *  forever in both directions: the scroller rests in the middle copy and is
 *  pushed back into it whenever a swipe or an advance leaves it. */
const COPIES = 3;
const MIDDLE = 1;

/** Reference cadence, measured by counting the auto-advance on a phone. */
const AUTOPLAY_MS = 5000;

/**
 * Above-the-fold banner for a signed-in visitor.
 *
 * The reference swaps its whole hero once you have an account. Logged out it
 * runs the two-column acquisition band (`Hero`); logged in that band is gone
 * and these three promo cards take the space — running promotion, game of the
 * week, deposit offer. The studio strip moves with it: it sits under the
 * signed-out hero, and drops to the foot of the column here, so this row is
 * followed directly by the first game rail. `pages/Home.jsx` owns that
 * ordering.
 *
 * **The three cards are a row on a desktop and a carousel on a phone**, and
 * that is the whole reason this component carries any JavaScript. The
 * reference's own markup for the row is `flex justify-between gap-4` with each
 * card `w-full` — which is what this file used to be, verbatim — and that is
 * correct from `sm` up. Below it, three cards cannot share a 390px line: they
 * shrink to their min-content width, which is set by the longest word in each
 * title, so they come out at three *different* widths (149, 104 and 132px at a
 * 215px viewport, measured on the reference itself), 410px tall, and still
 * overflow the column. That is the broken state this fixes. On a phone the
 * reference shows one card centred at ~63% of the viewport with its
 * neighbours peeking into the page gutter either side, and three dots under
 * it, advancing on its own and wrapping round for ever.
 *
 * Geometry, measured off the reference — the desktop numbers at 1536px, the
 * phone ones off a 428px capture:
 *
 * | | |
 * | --- | --- |
 * | Row, from `sm` | `flex justify-between gap-4`, each card `w-full` |
 * | Card, from `sm` | `min-h-[514px]`, `max-w-[496px]`, 16px radius, `#0F0025` under the art |
 * | Slide, below `sm` | 63% of the viewport (270px at 428), 410px tall, 16px gap |
 * | Dots | 8px, 8px apart, `trunks` for the current one and `trunks/40` for the rest |
 * | Art | one `background-image`, `cover`, centred — no `<img>` |
 * | Copy | bottom-aligned, centred, 8px between heading and blurb |
 * | Padding | 20px → 16px/20px at `sm` → 24px/28px at `lg` → 32px at `xl`, 36px at `2xl` |
 *
 * Three details on the card are load-bearing:
 *
 * 1. The card is `justify-end`, so the copy sits on the foot of the art
 *    whatever the card's height. The art is drawn to expect that — its lower
 *    half is a scrim (see `bannerArt` in scripts/art.mjs), which is why there
 *    is no overlay element here.
 * 2. The heading scale is non-monotonic, exactly as the reference has it: 24px
 *    on mobile, *down* to 18px at `md` where three cards first share the row
 *    and each is at its narrowest, then back up through 24px to 32px. Matching
 *    that is what keeps the headings to two lines at every width.
 * 3. The blurb is dropped below `md`. At that width the card is too narrow to
 *    set it at a readable measure, and the reference hides it rather than
 *    letting it wrap to six lines.
 *
 * The link is a stretched overlay rather than a wrapper, which is how the
 * reference does it: the card keeps its content layer unwrapped so the whole
 * tile is one hit target without nesting the text inside an `<a>`.
 *
 * One DOM serves both layouts rather than a carousel and a grid with one of
 * them `hidden` — the reference ships that pair on its loyalty page and it is
 * the thing `docs/11` calls out. The scroller stops scrolling at `sm`
 * (`sm:overflow-x-visible`, `sm:snap-none`), the extra copies go `sm:hidden`,
 * and what is left is the reference's row, three children and all.
 */
export function HomeBanner() {
  const N = HOME_BANNERS.length;
  /** Placement -> uploaded art. Empty when no operator has uploaded any. */
  const { data: uploaded } = useBanners();
  const trackRef = useRef(null);
  const settleRef = useRef(0);
  const pausedRef = useRef(false);
  /** Which banner the carousel should be sitting on, 0-based within one copy. */
  const restingRef = useRef(0);
  const [active, setActive] = useState(0);

  /**
   * Every measurement goes through `getBoundingClientRect`, never `scrollLeft`
   * against `offsetLeft`. Under RTL `scrollLeft` runs negative and the slides
   * are laid out from the right, so arithmetic on it needs a sign for the
   * direction; rect offsets from the scroller's own centre need none, and
   * `scrollBy` takes the same signed delta in both directions.
   *
   * Returns the distance each slide's centre would have to travel to land on
   * the scroller's centre.
   */
  const offsets = useCallback(() => {
    const el = trackRef.current;
    if (!el) return [];
    const box = el.getBoundingClientRect();
    const middle = box.left + box.width / 2;
    return Array.from(el.children, (slide) => {
      const r = slide.getBoundingClientRect();
      return r.left + r.width / 2 - middle;
    });
  }, []);

  const nearest = (offs) =>
    offs.reduce((best, o, i) => (Math.abs(o) < Math.abs(offs[best]) ? i : best), 0);

  /** False from `sm` up, where the row fits and nothing scrolls. */
  const isCarousel = () => {
    const el = trackRef.current;
    return !!el && el.scrollWidth - el.clientWidth > 8;
  };

  /** Bring the banner the carousel is resting on to the centre of the copy in
   *  the middle. Also the normaliser: called from anywhere the scroller may
   *  have drifted into one of the spare copies, it walks it back. */
  const centre = useCallback(
    (behavior) => {
      const el = trackRef.current;
      if (!el || !isCarousel()) return;
      el.scrollBy({ left: offsets()[restingRef.current + N], behavior });
    },
    [N, offsets],
  );

  /**
   * Called once the scrolling has stopped: remember where it stopped, and put
   * the scroller back in the middle copy if a swipe or an advance carried it
   * out of one. The copies are identical, so the jump is invisible — as long
   * as the sub-pixel offset the slide is currently sitting at is preserved,
   * which is why this shifts by the *difference* between the two offsets
   * rather than scrolling the target slide to dead centre.
   */
  const settle = useCallback(() => {
    const el = trackRef.current;
    if (!el || !isCarousel()) return;
    const offs = offsets();
    const from = nearest(offs);
    restingRef.current = from % N;
    if (from >= N && from < 2 * N) return;
    el.scrollBy({ left: offs[restingRef.current + N] - offs[from], behavior: 'instant' });
  }, [N, offsets]);

  const handleScroll = () => {
    const offs = offsets();
    if (offs.length === 0) return;
    setActive(nearest(offs) % N);
    // Normalising mid-flight would fight the smooth scroll that is still
    // running, so it waits for the scrolling to stop. `scrollend` would say
    // that exactly, but Safari only learned it in 18.2.
    clearTimeout(settleRef.current);
    settleRef.current = setTimeout(settle, 120);
  };

  /**
   * Open on the middle copy, so the first card is centred with a neighbour
   * peeking either side rather than sitting flush against the left edge.
   *
   * A `ResizeObserver` rather than only a one-shot effect, because the resting
   * position is a function of the track's width and that width is not settled
   * when the effect first runs: the page grows a scrollbar as the rails below
   * render, which takes 15px off the track and moves every snap point. Under
   * `snap-mandatory` the browser then re-snaps to whatever is nearest in the
   * new layout, which is a whole card out by the third slide — that is the
   * off-by-one this observer exists to undo. Later callbacks cover the same
   * thing on rotation and across the `sm` boundary, where the scroller becomes
   * the reference's row and back.
   */
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    centre('instant');
    const observer = new ResizeObserver(() => centre('instant'));
    observer.observe(el);
    return () => observer.disconnect();
  }, [centre]);

  useEffect(() => () => clearTimeout(settleRef.current), []);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => {
      const el = trackRef.current;
      if (!el || pausedRef.current || document.hidden || !isCarousel()) return;
      const offs = offsets();
      // Always forward, one slide at a time, and never back to the start —
      // `settle` keeps the resting slide inside the middle copy, so there is
      // another copy of the whole set ahead to advance into. The clamp is for
      // the case where a scroll event was missed and the position has drifted
      // past the copies: advancing off the end would scroll by `undefined`.
      el.scrollBy({
        left: offs[Math.min(nearest(offs) + 1, offs.length - 1)],
        behavior: 'smooth',
      });
    }, AUTOPLAY_MS);
    return () => clearInterval(id);
  }, [offsets]);

  const goTo = (i) => {
    const el = trackRef.current;
    if (!el || !isCarousel()) return;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    restingRef.current = i;
    el.scrollBy({ left: offsets()[i + N], behavior: smooth ? 'smooth' : 'instant' });
  };

  return (
    <section
      aria-label="Featured"
      aria-roledescription="carousel"
      className="flex flex-col gap-4"
      onPointerEnter={() => (pausedRef.current = true)}
      onPointerLeave={() => (pausedRef.current = false)}
      onFocusCapture={() => (pausedRef.current = true)}
      onBlurCapture={() => (pausedRef.current = false)}
    >
      <div
        ref={trackRef}
        onScroll={handleScroll}
        className={[
          // Below `sm`: a scroller carrying one card centred and its
          // neighbours peeking. `-mx-4` cancels `main`'s gutter so the peek
          // runs to the edge of the screen, as it does on the reference, and
          // it is also what makes the slide's 63% resolve against the whole
          // viewport — 270px at the 428px the reference was measured on.
          'no-scrollbar -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain',
          // From `sm`: the reference's row, and nothing scrolls.
          'sm:mx-0 sm:snap-none sm:justify-between sm:overflow-x-visible',
        ].join(' ')}
      >
        {Array.from({ length: COPIES * N }, (_, i) => {
          const banner = HOME_BANNERS[i % N];
          const copy = Math.floor(i / N);
          const spare = copy !== MIDDLE;

          return (
            <div
              key={`${copy}-${banner.id}`}
              // The two spare copies exist to make the loop seamless, not to
              // be read: assistive technology and the tab order see the middle
              // copy's three cards and nothing else.
              aria-hidden={spare || undefined}
              className={cn(
                'relative w-[63%] shrink-0 snap-center',
                spare ? 'sm:hidden' : 'sm:w-full sm:shrink',
              )}
            >
              <div
                style={{ backgroundImage: `url(${uploaded?.get(banner.id)?.url ?? banner.art})` }}
                className={[
                  'relative flex flex-col justify-end gap-2 overflow-hidden rounded-2xl',
                  'bg-[#0F0025] bg-cover bg-center bg-no-repeat',
                  'min-h-[410px] p-5',
                  'sm:h-full sm:min-h-[300px] sm:max-w-[250px] sm:px-4 sm:py-5',
                  'lg:min-h-[400px] lg:max-w-[350px] lg:px-6 lg:py-7',
                  'xl:min-h-[514px] xl:max-w-[496px] xl:px-8 2xl:py-9',
                ].join(' ')}
              >
                <h2
                  className={[
                    'text-center font-secondary font-medium text-goten',
                    'text-2xl md:text-[18px] md:leading-4',
                    'lg:text-[24px] lg:leading-6 xl:text-[32px] xl:leading-8',
                  ].join(' ')}
                >
                  {banner.title}
                </h2>

                <p className="px-14 text-center text-sm font-normal text-goten max-md:hidden md:px-0">
                  {banner.blurb}
                </p>
              </div>

              {/* Stretched hit target. Sits above the card so the whole tile is
                  clickable, and carries the accessible name for the link. */}
              <Link
                to={banner.href}
                aria-label={banner.title}
                tabIndex={spare ? -1 : undefined}
                className={[
                  'absolute inset-0 z-1 rounded-2xl',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-piccolo',
                ].join(' ')}
              />
            </div>
          );
        })}
      </div>

      {/* Dots. `trunks` at full strength for the card on screen and at 40% for
          the rest — read off the reference's own pixels, where the inactive
          mark resolves to rgb(203,200,199) on white, which is `trunks` at 0.4.
          The 8px mark is too small to hit, so `before` grows the target to
          24px without moving the 16px pitch. */}
      <div className="flex justify-center gap-2 sm:hidden">
        {HOME_BANNERS.map((banner, i) => (
          <button
            key={banner.id}
            type="button"
            onClick={() => goTo(i)}
            aria-label={`Show ${banner.title}`}
            aria-current={i === active}
            className={cn(
              'relative size-2 rounded-full bg-trunks transition-opacity',
              "before:absolute before:-inset-2 before:content-['']",
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-piccolo',
              i === active ? 'opacity-100' : 'opacity-40',
            )}
          />
        ))}
      </div>
    </section>
  );
}
