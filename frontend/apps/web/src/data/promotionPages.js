// Extensions, unlike everywhere else in the app: `scripts/generate-assets.mjs`
// imports this module in bare Node to find out which promo art to draw, and
// Node's ESM resolver does not do Vite's extensionless lookup.
import { LEAGUE } from './league.js';
import { SPIN_WHEEL } from './spinWheel.js';
import { WEEKLY_RAKEBACK } from './weeklyRakeback.js';

/**
 * The promotions that have a page of their own.
 *
 * One list, built from the campaigns' own data rather than restated, so a
 * renamed campaign or a new hero cannot drift between the page and the two
 * places that link to it — `PromoLayout`'s `Other promotions` rail, and the
 * `/promotions` index itself, which renders this first and then tops up from
 * `PROMOTIONS` in `catalog.js` (the cards that link somewhere other than a
 * promotion page).
 *
 * `blurb` is the one line under the title on a promotion card. It is the
 * campaign's own — the reference's word for word where there is a reference
 * campaign to copy — and not written here, for the same reason the title is
 * not.
 *
 * Anything added here needs a route in `App.jsx` under the same slug —
 * `promotions/:slug` redirects everything else to the index.
 */
export const PROMO_PAGES = [LEAGUE, WEEKLY_RAKEBACK, SPIN_WHEEL].map((promo) => ({
  slug: promo.slug,
  title: promo.title,
  blurb: promo.blurb,
  href: `/promotions/${promo.slug}`,
  art: promo.art,
}));
