/**
 * Weekly Rakeback — the campaign behind the home banner's middle card.
 *
 * Four fields, because four fields is everything the reference publishes about
 * this campaign: a slug, a title, a picture, and the one line on its promotion
 * card. **Its detail page has an empty body** — verified in the rendered DOM,
 * the served HTML and the RSC payload; see the block at the top of
 * `pages/WeeklyRakeback.jsx`.
 *
 * So there is no prose, no rate table and no terms list here. Not because none
 * was written, but because writing one would put a campaign's rules on a page
 * whose source publishes none, and this project's whole premise is that you can
 * open the two side by side and compare them.
 *
 * `blurb` is the reference's own promotion card, word for word. It is the copy
 * on the home banner (`HOME_BANNERS` in `catalog.js` carries its own copy of
 * it, as it does for every card) rather than anything this page renders.
 */
export const WEEKLY_RAKEBACK = {
  /** The reference's own slug, year and all. */
  slug: 'weekly-rakeback-2026',
  title: 'Weekly Rakeback',
  /**
   * The reference serves the hero as a 700x290 request for the same picture
   * its promotion card uses, from `heathmont.imgix.net/cms/media/
   * weekly-rakeback-promo-bc.png`. Saved once at 992px wide — the size the
   * other lobby crops in that folder use — and cropped for the hero, because
   * the subject sits in the top 40% exactly as `banners/league.png` does. See
   * `docs/07-assets.md`.
   */
  art: '/images/banners/weekly-rakeback.webp',
  /** The reference's promotion card, word for word. */
  blurb:
    'Enjoy a full week of action on selected slots from Monday to Sunday and earn up to 5% Rakeback.',
};
