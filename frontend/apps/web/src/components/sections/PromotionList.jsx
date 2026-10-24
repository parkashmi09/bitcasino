import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/cn';

/**
 * The `/promotions` list and the tab bar above it, measured off the
 * reference's own `/promotions` at 1536px.
 *
 * | | |
 * | --- | --- |
 * | Page | `flex flex-col gap-6 max-w-[83rem]`, no `h1` |
 * | Tabs | one `border-b` rule across the full width, 14px `trunks` |
 * | List | `py-2.5 grid gap-4` |
 * | Row | `grid-cols-[minmax(200px,700px)_300px] gap-10` from `md` up |
 * | Picture | 700x290, `rounded-xl` |
 * | Copy | `pt-4`, then 24px/32 medium title, 16px/24 blurb, `gap-4` |
 * | Read more | `w-28 h-10` `piccolo`, 16px **normal** weight, `mt-4` |
 *
 * Below `md` the row becomes one `gohan` card with the picture on top — that
 * is the reference's own breakpoint behaviour (`bg-gohan md:bg-[unset]`), not
 * a responsive fix added here.
 *
 * Two departures, both the kind `docs/11` asks to be written down:
 *
 * 1. **`Read more` is a `span`, not a `button`.** The reference nests a real
 *    `<button>` inside the row's `<a>`, which is invalid HTML and gives a
 *    keyboard user two stops on one destination. The pixels are identical.
 * 2. **The page keeps an `h1`, visually hidden.** The reference's promotions
 *    page has no heading element at all; a screen reader lands on a list of
 *    links with nothing naming the page.
 */
export function PromotionTabs({ participations = 0 }) {
  const { pathname } = useLocation();

  return (
    /* 0.1rem, not `border-b-2`: the reference's Moon config puts `border-2`
       at 0.1rem and it measures 1.6px. */
    <div className="mt-1 w-full border-b-[0.1rem] pb-1 text-sm/6 text-trunks">
      <Tab to="/promotions" active={pathname === '/promotions'}>
        All promotions
      </Tab>
      <Tab
        to="/promotions/participations"
        active={pathname === '/promotions/participations'}
      >
        My participations
        <span className="ml-2">{participations}</span>
      </Tab>
    </div>
  );
}

/**
 * `display: inline`, as the reference has it — so the 8px padding widens the
 * hit area without growing the 30px bar, and the underline of the active tab
 * lands on the same rule the bar already draws.
 */
function Tab({ to, active, children }) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={cn('inline p-2 hover:text-bulma', active && 'border-b-[0.1rem] text-bulma')}
    >
      {children}
    </Link>
  );
}

/** The list itself. `promotions` is `[{slug, title, blurb, href, art}]`. */
export function PromotionRows({ promotions }) {
  return (
    <div className="grid gap-4 py-2.5">
      {promotions.map((promo) => (
        <PromotionRow key={promo.slug} promo={promo} />
      ))}
    </div>
  );
}

function PromotionRow({ promo }) {
  return (
    <Link to={promo.href} className="block">
      <div className="block rounded-xl bg-gohan px-4 pt-2 pb-6 md:grid md:grid-cols-[minmax(12.5rem,43.75rem)_18.75rem] md:gap-10 md:rounded-none md:bg-transparent md:p-0">
        {/* `object-top`, like the detail hero: the two campaigns with real
            artwork carry the 992x1028 lobby crop, whose subject is in the top
            40%. The generated 700x290 promo art is unaffected by either. */}
        <img
          src={promo.art}
          alt=""
          width={700}
          height={290}
          loading="lazy"
          className="block aspect-[700/290] w-full rounded-xl object-cover object-top"
        />

        <div>
          <div className="grid auto-rows-max gap-4 pt-4">
            <div className="grid auto-rows-max gap-4 px-2 md:p-0">
              <h3 className="text-base font-medium text-bulma md:text-2xl md:leading-8">
                {promo.title}
              </h3>
              <p className="text-base leading-6 text-bulma">{promo.blurb}</p>
            </div>

            {/* The reference tints only the button, and only under the
                pointer — the row's title and picture do not react. */}
            <span className="mt-4 flex h-10 w-28 items-center justify-center rounded-i-sm bg-piccolo px-4 text-base font-normal text-goten transition-colors duration-200 hover:bg-piccolo-80">
              Read more
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
