/**
 * Weekly Rakeback — the campaign behind the home banner's middle card.
 *
 * A slug, a title, a picture and one line of copy. The line is both the
 * promotion card's blurb and the detail page's body (`pages/WeeklyRakeback.jsx`),
 * so a visitor opening the page reads more than its title. It promises no rate:
 * the rate is the player's VIP card's, read live from `GET /user/rakeback`.
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
  blurb: 'Get a share of every bet back as rakeback each week. Your rate is set by your VIP level.',
};
