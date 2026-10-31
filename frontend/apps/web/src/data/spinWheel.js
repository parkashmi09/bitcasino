/**
 * The spin wheel, as a promotion.
 *
 * The wheel is the one promotion on this app that is **not** transcribed copy
 * over a static campaign: `GET /user/spin-wheel/slices` is a real route with
 * real segments behind it, and `POST /user/spin-wheel/spin` really issues a
 * redeem code. See `queries/promotions.js`.
 *
 * It used to live on `/promotions` itself, as one of two panels on a page the
 * reference builds as a list of campaigns. That is why it moved: the index is
 * a list, and a feature that is not a list item does not belong on it. It has
 * a page of its own now, at the slug below, and appears in the list the same
 * way the League does.
 *
 * The blurb states the mechanic rather than a prize, for the reason
 * `pages/SpinWheel.jsx` restates at length: a spin pays a bonus percentage on
 * the next deposit and never credits a balance.
 */
export const SPIN_WHEEL = {
  slug: 'spin-the-wheel',
  title: 'Spin the wheel',
  /**
   * Generated, unlike the League's and the Rakeback's — there is no reference
   * artwork for this one because there is no such promotion on the reference.
   * `promoArt` in `scripts/art.mjs` draws it at the 700x290 the card wants.
   */
  art: '/images/promos/spin-the-wheel.svg',
  blurb:
    'Your first spin is free, and every qualifying deposit earns another. Each segment is a bonus percentage off your next deposit.',
};
