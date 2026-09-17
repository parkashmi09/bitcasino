import { Link, useSearchParams } from 'react-router-dom';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { PromotionRows, PromotionTabs } from '@/components/sections/PromotionList';
import { PAST_PROMOTIONS, PROMOTIONS } from '@/data/catalog';
import { PROMO_PAGES } from '@/data/promotionPages';

/**
 * `/promotions` — every promotion this app is running, as a list.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * THIS PAGE USED TO BE THE SPIN WHEEL AND A BONUS LOG, SIDE BY SIDE.
 *
 * The reference's promotions index is a list of campaigns: a tab bar, then
 * one 700x290 picture per promotion with a title, a line and a `Read more`
 * beside it, then a toggle for the finished ones. It has no wheel, no
 * account panel and no `h1`. What this page rendered instead was two cards
 * — a bonus history and a spin wheel — which is not a different arrangement
 * of the same page, it is a different page.
 *
 * Both of those things were real and neither was thrown away:
 *
 * - the wheel is a promotion now, with a page of its own at
 *   `/promotions/spin-the-wheel` and a row in this list (`data/spinWheel.js`);
 * - the bonus log moved under the reference's own second tab, at
 *   `/promotions/participations` (`pages/Participations.jsx`).
 *
 * The block that used to be here about `GET /user/bonus/events` not being an
 * operator promotions feed is still true and now lives on that page, next to
 * the code it is about.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * The list is `PROMO_PAGES` — the campaigns with a page behind them — and
 * then `PROMOTIONS`, the cards that point at a screen this app already has.
 * `components/sections/PromotionList.jsx` holds the measurements.
 */
export function Promotions() {
  const [params, setParams] = useSearchParams();

  // The reference's own parameter, spelled its way. It is a link there rather
  // than a control, so the back button undoes it; `setParams` with `replace`
  // off keeps that.
  const showPast = params.get('showPast') === 'true';

  const live = [...PROMO_PAGES, ...PROMOTIONS];
  const promotions = showPast ? [...live, ...PAST_PROMOTIONS] : live;

  return (
    <div className="flex max-w-[83rem] flex-col gap-6">
      {/* The reference ships this page with no heading element of any kind.
          See the departures note in `PromotionList.jsx`. */}
      <h1 className="sr-only">Promotions</h1>

      <PromotionTabs />

      <PromotionRows promotions={promotions} />

      <div className="grid justify-center">
        <button
          type="button"
          onClick={() => setParams(showPast ? {} : { showPast: 'true' })}
          /* The reference draws the outline as a 1px inset ring; a border does
             the same thing here and stays inside the 40px box either way. */
          className="flex h-10 cursor-pointer items-center justify-center rounded-i-sm border border-trunks px-4 text-base font-normal text-bulma transition-colors duration-200 hover:border-bulma hover:bg-heles"
        >
          {showPast ? 'Hide past promotions' : 'Show past promotions'}
        </button>
      </div>

      {/* Nothing on this app has finished yet — see `PAST_PROMOTIONS`. Saying
          so beats a toggle that appears to do nothing. */}
      {showPast && PAST_PROMOTIONS.length === 0 && (
        <p className="text-center text-sm text-trunks">
          None of these has finished yet. The League runs to 13 September 2026;
          everything else is a standing offer.{' '}
          <Link to="/tournaments/all/past" className="text-piccolo hover:underline">
            Finished tournaments
          </Link>{' '}
          are listed separately.
        </p>
      )}

      <Breadcrumb items={[{ label: 'Promotions' }]} className="mt-0" />
    </div>
  );
}
