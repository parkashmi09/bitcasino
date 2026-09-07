import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';

const POINTS = [
  'Huge selection of high RTP games',
  'Unparalleled VIP benefits',
  'Crypto Operator of the Year 2026',
];

/**
 * Above-the-fold banner.
 *
 * Geometry is measured off the reference rather than eyeballed. Three things
 * drive it:
 *
 * 1. The copy column is a grid with a flat 16px gap — every block is one row,
 *    so there are no per-element margins to keep in sync.
 * 2. The artwork column is capped at 788px and never grows past it; the copy
 *    column takes whatever is left (`1fr`), which is why the text squeezes
 *    rather than the art shrinking on a narrow desktop.
 * 3. Below 1200px the columns collapse into one and the artwork sits *under*
 *    the copy, not above it.
 *
 * The h1 scale is non-monotonic on purpose: the reference steps it down from
 * 32px to 28px when the two-column layout kicks in at 1200px, because the copy
 * column is at its narrowest there, then up to 40px once there is room again
 * (~1500px). Matching that is what keeps the line wraps identical.
 */
export function Hero() {
  return (
    <section
      className={[
        'grid min-h-[304px] gap-4 rounded-i-md md:min-h-[512px]',
        'xl:grid-cols-[1fr_minmax(0,788px)] xl:items-center xl:rounded-b-none',
      ].join(' ')}
    >
      <div className="grid max-w-[576px] gap-4 xl:pe-4 min-[1500px]:pe-14">
        <h1
          className={[
            'font-secondary font-normal text-bulma',
            'text-[24px] leading-8',
            'md:text-[32px] md:leading-[1.3333]',
            'xl:text-[28px] xl:leading-8',
            'min-[1500px]:text-[40px] min-[1500px]:leading-10',
          ].join(' ')}
        >
          Join the world&rsquo;s first licensed Bitcoin casino
        </h1>

        <p className="text-base leading-6 text-bulma md:text-xl md:leading-7">
          Get up to 5,000 USDT across your first three deposits*
        </p>

        {/* #858585 is lighter than --trunks; the reference uses it for this
            list only, and keeps --trunks for the fine print below. */}
        <ul className="text-[18px] leading-7 text-[#858585]">
          {POINTS.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>

        {/* Wrapped so the button sizes to its content rather than stretching
            across the grid column. */}
        <div>
          <Button as={Link} to="/register" size="xl">
            Join Us
          </Button>
        </div>

        <p className="text-base leading-6 text-trunks">
          Enjoy industry-leading transaction speeds
        </p>

        <a
          href="#getting-started"
          className="justify-self-start text-xs leading-4 text-trunks underline underline-offset-2 hover:text-bulma"
        >
          *How it works
        </a>
      </div>

      <div className="w-full max-w-[788px]">
        <img
          src="/images/hero.avif"
          alt=""
          width={788}
          height={562}
          fetchPriority="high"
          className="block aspect-[788/562] w-full object-fill"
        />
      </div>
    </section>
  );
}
