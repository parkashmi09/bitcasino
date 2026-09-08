import { useAuth } from '@/auth/AuthProvider';
import { Hero } from '@/components/sections/Hero';
import { HomeBanner } from '@/components/sections/HomeBanner';
import { GameRail } from '@/components/sections/GameRail';
import { ThemeRail } from '@/components/sections/ThemeRail';
import { TrustSection } from '@/components/sections/TrustSection';
import { ProviderRail } from '@/components/sections/ProviderRail';
import { Testimonials } from '@/components/sections/Testimonials';
import { HOME_RAILS, THEME_RAIL_INDEX } from '@/data/catalog';

/**
 * Section order follows the reference home page.
 *
 * Read off the reference's own signed-in column on 2026-09-08, top to bottom:
 *
 *     y  104  h 514   the three-card banner row
 *     y  650  h 240   Originals
 *          …          six more rails, Themes seventh
 *     y 2926  h 300   the collapsed editorial panel
 *     y 3258  h  80   the studio strip  <- LAST
 *
 * The two structural details that fall out of it: the banner is followed
 * **directly** by the first game rail, and the studio strip is the last thing
 * on the page rather than the first thing under the banner. This file had the
 * strip second, which put a row of greyscale wordmarks between the promo cards
 * and Originals that the reference does not have anywhere.
 *
 * The strip reads as a credibility footnote under the editorial copy, not as a
 * band competing with the hero — which is also why it carries no heading.
 *
 * Every game rail then runs consecutively, with all editorial content below
 * them: the rails are never interleaved with marketing.
 *
 * Two things move between the session states.
 *
 * The above-the-fold band is swapped outright: signed out it runs `Hero`, the
 * two-column acquisition band with the "Join the world's first licensed
 * Bitcoin casino" headline and the Join Us button; signed in that band is gone
 * and `HomeBanner`'s row of three promo cards takes the space.
 *
 * The studio strip then follows the band it sits under. Signed out the
 * reference puts it directly beneath the hero, where it backs the pitch the
 * hero just made — the wordmarks are the evidence for "huge selection of high
 * RTP games", so they belong next to the claim. Signed in there is no claim to
 * back: the player already has an account, the promo cards are an offer rather
 * than an argument, and the strip drops to the foot of the column as a
 * credibility footnote under the editorial panel. Both positions are the
 * reference's own; the order in the measured column above is the signed-in
 * one.
 *
 * The third state is `loading`, which only happens when a refresh token is
 * being exchanged on a reload — i.e. when a session most likely exists.
 * Rendering `Hero` through it would flash the acquisition pitch, Join Us
 * button and all, at a player who is already signed in; rendering `HomeBanner`
 * would do the mirror of that. So it holds the space instead, sized to the
 * banner it usually resolves to, and neither pitch is shown until the answer
 * is known. The strip stays at the foot through `loading` for the same reason:
 * that is where it lands in the state `loading` usually resolves to, so it
 * does not jump once the session lands.
 *
 * The reference folds the whole editorial tail (trust, game breakdown,
 * providers, promotions, the crypto explainer and the getting-started guide)
 * into `TrustSection`'s single collapsed panel rather than a run of separate
 * bands. `CategoryStrip`, `SeoContent`, `PromoGrid`, `VipBanner`,
 * `CryptoFeatures`, `AccessAnywhere` and `GettingStarted` still exist as
 * components, but the home page no longer renders them.
 */
export function Home() {
  const { status } = useAuth();
  const signedOut = status === 'anonymous';
  const railsBeforeThemes = HOME_RAILS.slice(0, THEME_RAIL_INDEX);
  const railsAfterThemes = HOME_RAILS.slice(THEME_RAIL_INDEX);

  return (
    <>
      {status === 'authenticated' && <HomeBanner />}
      {signedOut && <Hero />}
      {status === 'loading' && <AboveTheFoldSkeleton />}

      {signedOut && <ProviderRail />}

      {railsBeforeThemes.map((rail, i) => (
        <GameRail key={rail.title} {...rail} featured={i === 0} />
      ))}

      <ThemeRail />

      {railsAfterThemes.map((rail) => (
        <GameRail key={rail.title} {...rail} />
      ))}

      <TrustSection />
      <Testimonials />
      {!signedOut && <ProviderRail />}
    </>
  );
}

/**
 * Placeholder for the one slot that depends on the session.
 *
 * Heights track `HomeBanner`'s card at every breakpoint so the rails below do
 * not jump when the session resolves. It is deliberately empty rather than a
 * shimmering skeleton: this resolves in one round trip, and a card-shaped
 * pulse that turns into a *different* layout half the time reads worse than
 * quiet space.
 */
function AboveTheFoldSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="min-h-[410px] sm:min-h-[300px] lg:min-h-[400px] xl:min-h-[514px]"
    />
  );
}
