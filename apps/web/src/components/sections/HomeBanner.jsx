import { Link } from 'react-router-dom';
import { HOME_BANNERS } from '@/data/catalog';

/**
 * Above-the-fold banner for a signed-in visitor.
 *
 * The reference swaps its whole hero once you have an account. Logged out it
 * runs the two-column acquisition band (`Hero`); logged in that band is gone
 * and this row of three equal promo cards takes the space — running promotion,
 * game of the week, deposit offer. The studio strip moves with it: it sits
 * under the signed-out hero, and drops to the foot of the column here, so this
 * row is followed directly by the first game rail. `pages/Home.jsx` owns that
 * ordering.
 *
 * Geometry, measured off the reference at 1536px:
 *
 * | | |
 * | --- | --- |
 * | Row | `flex justify-between gap-4`, each card `w-full` |
 * | Card | `min-h-[514px]`, `max-w-[496px]`, 16px radius, `#0F0025` under the art |
 * | Art | one `background-image`, `cover`, centred — no `<img>` |
 * | Copy | bottom-aligned, centred, 8px between heading and blurb |
 * | Padding | 20px → 16px/20px at `sm` → 24px/28px at `lg` → 32px at `xl`, 36px at `2xl` |
 *
 * Three details are load-bearing:
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
 * reference does it: the card keeps `pointer-events-none` on its content layer
 * so the whole tile is one hit target without nesting the text inside an `<a>`.
 */
export function HomeBanner() {
  return (
    <section aria-label="Featured" className="flex justify-between gap-4">
      {HOME_BANNERS.map((banner) => (
        <div key={banner.id} className="relative w-full">
          <div
            style={{ backgroundImage: `url(${banner.art})` }}
            className={[
              'relative flex flex-col justify-end gap-2 overflow-hidden rounded-2xl',
              'bg-[#0F0025] bg-cover bg-center bg-no-repeat',
              'min-h-[410px] max-w-[396px] p-5',
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
            className={[
              'absolute inset-0 z-1 rounded-2xl',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-piccolo',
            ].join(' ')}
          />
        </div>
      ))}
    </section>
  );
}
