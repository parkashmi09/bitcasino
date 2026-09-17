import { PromoPage } from '@/components/sections/PromoLayout';
import { WEEKLY_RAKEBACK } from '@/data/weeklyRakeback';

/**
 * `/promotions/weekly-rakeback-2026` — the home banner's middle card, at the
 * reference's own slug.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE BODY IS EMPTY BECAUSE THE REFERENCE'S IS EMPTY. THAT IS THE PAGE.
 *
 * Their `/promotions/weekly-rakeback-2026` renders a hero, the title, the
 * `Other promotions` rail and the breadcrumb — and nothing between the title
 * and the foot of the column. Checked three ways: the rendered DOM, the served
 * HTML document, and the RSC flight payload inside it. The CMS body container
 * is present and has no children in all three, so there is no copy to
 * transcribe and none is being withheld from a signed-out visitor.
 *
 * This file therefore has no sections. Anything here — a blurb, a rates table,
 * a "how it works" — would be content this project wrote and the reference does
 * not publish, which is the one thing a clone must not do quietly.
 *
 * The layout, the hero crop and the rail all come from `PromoLayout`, which is
 * shared with `League` and carries the measurements taken off the reference.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Worth knowing if this page is ever meant to do something: the platform has
 * a **live rakeback mechanic** — `GET /user/rakeback` answers the caller's
 * accrued balance, their rate and the claim floor, and `POST
 * /user/rakeback/claim` pays it into the USDT balance under a row lock
 * (`backend/services/user/src/modules/rakeback`). `docs/10` lists it among the
 * routes with no screen. It stays off this page while the page is a
 * reproduction of one that has no screen either.
 */
export function WeeklyRakeback() {
  return <PromoPage promo={WEEKLY_RAKEBACK} />;
}
