import { Button } from '@/components/ui/Button';
import { PromoPage } from '@/components/sections/PromoLayout';
import { WEEKLY_RAKEBACK } from '@/data/weeklyRakeback';
import { useAuth } from '@/auth/AuthProvider';
import { useClaimRakeback, useRakeback } from '@/queries/rewards';
import { formatBalance } from '@/lib/format';

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
 * This file therefore has no marketing sections. Anything here — a blurb, a rates table,
 * a "how it works" — would be content this project wrote and the reference does
 * not publish, which is the one thing a clone must not do quietly.
 *
 * The layout, the hero crop and the rail all come from `PromoLayout`, which is
 * shared with `League` and carries the measurements taken off the reference.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * ## The one live part: the player's own rakeback
 *
 * Signed in, the body carries the account's accrued rakeback —
 * `GET /user/rakeback` → `{amount, currency, claimable, minimum, rate}` — and
 * `Claim`, `POST /user/rakeback/claim`, which pays it to the balance under a
 * row lock. The route gate (`rewards`) is the promotions capability, which is
 * the only gate the platform puts on rakeback. Signed out, the page is the
 * reference's, unchanged.
 */
export function WeeklyRakeback() {
  const { status } = useAuth();
  return (
    <PromoPage promo={WEEKLY_RAKEBACK}>
      {status === 'authenticated' && <RakebackCard />}
    </PromoPage>
  );
}

/** `rate` is a fraction of stake (`0.002` = 0.2%), set by the player's VIP card. */
function RakebackCard() {
  const { data, isPending, isError } = useRakeback();
  const claim = useClaimRakeback();
  if (isPending || isError || !data) return null;

  const rate = data.rate == null ? null : `${+(Number(data.rate) * 100).toFixed(4)}%`;

  return (
    <section className="grid gap-3 rounded-i-sm bg-gohan p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-base text-bulma">Your rakeback</span>
        <span className="text-xl font-bold text-bulma tabular-nums">
          {formatBalance(data.amount)} {data.currency}
        </span>
      </div>
      {rate && <p className="text-sm text-trunks">Your rate: {rate} of every bet.</p>}
      {data.claimable ? (
        <Button size="lg" onClick={() => claim.mutate()} disabled={claim.isPending}>
          {claim.isPending ? 'Claiming…' : 'Claim'}
        </Button>
      ) : (
        <p className="text-sm text-trunks">
          Claimable from {data.minimum} USD worth of rakeback.
        </p>
      )}
      {claim.isError && (
        <p role="alert" className="text-sm text-chichi">
          {claim.error?.message || 'The claim was refused.'}
        </p>
      )}
    </section>
  );
}
