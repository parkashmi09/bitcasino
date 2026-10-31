import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { HOME_BANNERS } from '@/data/catalog';
import { withBrand } from '@/lib/branding';
import { useSiteName } from '@/queries/siteConfig';
import { useGates } from '@/hooks/useGates';
import { useHomeSlides } from '@/queries';
import { cn } from '@/lib/cn';
import { Rail } from './Rail';

/**
 * ═════════════════════════════════════════════════════════════════════════
 * THE CARDS ARE THE SITE ADMIN'S SLIDES, IN DIRECT MODE
 *
 * `GET /admin/banners?mode=direct` (`useHomeSlides`): every `slider-<n>`
 * placement, in `sortOrder`, with its own title, subtitle and CTA link. When
 * the admin has uploaded none, `HOME_BANNERS` in `catalog.js` is drawn
 * instead. Either way a card into a switched-off section is dropped, and the
 * whole row follows the site's `home_heroSection` toggle (off = no request).
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
  const { flag, routeOn } = useGates();
  const show = flag('home_heroSection');
  const { data: slides } = useHomeSlides({ enabled: show });
  const site = useSiteName();
  const banners = (slides?.length ? slides : withBrand(HOME_BANNERS, site)).filter(
    (banner) => !banner.href || routeOn(banner.href),
  );
  const N = banners.length;
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

  if (!show || N === 0) return null;

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
      {/* From `sm`: the reference's row, measured on bitcasino.io at 1920 — three 499×304 cards, 12px
          apart, the rest a scroll away (Rail's arrows). */}
      <Rail title="Featured promotions" headingClassName="sr-only" className="-mt-5 max-sm:hidden">
        {banners.map((banner) => (
          <BannerCard key={banner.id} banner={banner} className="w-[calc((100%-24px)/3)] shrink-0" />
        ))}
      </Rail>

      {/* Below `sm`: a looping scroller with one card centred and its neighbours peeking. `-mx-4`
          cancels `main`'s gutter so the peek runs to the screen edge. */}
      <div
        ref={trackRef}
        onScroll={handleScroll}
        className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain sm:hidden"
      >
        {Array.from({ length: COPIES * N }, (_, i) => {
          const banner = banners[i % N];
          const copy = Math.floor(i / N);
          const spare = copy !== MIDDLE;

          return (
            <BannerCard
              key={`${copy}-${banner.id}`}
              banner={banner}
              // The spare copies make the loop seamless; assistive technology and the tab order
              // see the middle copy only.
              spare={spare}
              className="w-[80%] shrink-0 snap-center"
            />
          );
        })}
      </div>

      {/* Dots. `trunks` at full strength for the card on screen and at 40% for
          the rest — read off the reference's own pixels, where the inactive
          mark resolves to rgb(203,200,199) on white, which is `trunks` at 0.4.
          The 8px mark is too small to hit, so `before` grows the target to
          24px without moving the 16px pitch. */}
      <div className="flex justify-center gap-2 sm:hidden">
        {banners.map((banner, i) => (
          <button
            key={banner.id}
            type="button"
            onClick={() => goTo(i)}
            aria-label={`Show ${banner.title || `slide ${i + 1}`}`}
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

/**
 * One promo card, sized as the reference's: 499×304, 12px corners, art covering it; the title
 * (Big Shoulders 900, uppercase) and blurb sit top-left in the left 40%, scaled to the card width.
 */
function BannerCard({ banner, spare = false, className }) {
  return (
    <div aria-hidden={spare || undefined} className={cn('@container relative', className)}>
      <div
        style={{ backgroundImage: `url(${banner.art})` }}
        className="relative aspect-[499/304] overflow-hidden rounded-[12px] bg-[#0F0025] bg-cover bg-center bg-no-repeat"
      >
        <div className="absolute left-[5.4%] top-[8.9%] w-[40%] text-goten">
          <h2 className="font-display text-[7.6cqw] font-black uppercase leading-none">{banner.title}</h2>
          {banner.blurb && <p className="mt-[3.4cqw] text-[3.27cqw] leading-[1.33]">{banner.blurb}</p>}
        </div>
      </div>
      {banner.href && (
        <CardLink
          href={banner.href}
          aria-label={banner.title || 'Promotion'}
          tabIndex={spare ? -1 : undefined}
          className="absolute inset-0 z-1 rounded-[12px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-piccolo"
        />
      )}
    </div>
  );
}

/** An admin CTA may be an absolute http(s) url, which `Link` would read as a path. */
function CardLink({ href, ...props }) {
  return /^https?:/i.test(href) ? <a href={href} {...props} /> : <Link to={href} {...props} />;
}
