import { useAuth } from '@/auth/AuthProvider';
import { Hero } from '@/components/sections/Hero';
import { HomeBanner } from '@/components/sections/HomeBanner';
import { CatalogueRail } from '@/components/sections/CatalogueRail';
import { LatestWins } from '@/components/sections/LatestWins';
import { ThemeRail } from '@/components/sections/ThemeRail';
import { TrustSection } from '@/components/sections/TrustSection';
import { ProviderRail } from '@/components/sections/ProviderRail';
import { Testimonials } from '@/components/sections/Testimonials';
import { useSiteConfig } from '@/queries';
import { HOME_RAILS, THEME_RAIL_INDEX } from '@/data/homeRails';

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
  const { config } = useSiteConfig();
  const signedOut = status === 'anonymous';

  /**
   * Operator flags gate three of the seven rails.
   *
   * `home_livecasino`, `home_popularslots` and `home_crashgames` are the
   * platform's own `home_*` section toggles, and they name exactly the three
   * rails backed by a curated collection — which is the pairing that makes
   * sense, since both the flag and the row are things an operator edits. The
   * other four have no flag and always render.
   *
   * `config.flag()` answers `true` for anything it has not been told about, so
   * this shows every rail before the config lands and on a deployment that has
   * never been configured. See `data/adapters/siteConfig.js`.
   */
  const RAIL_FLAGS = {
    'live-casino': 'home_livecasino',
    'popular-slots': 'home_popularslots',
    crash: 'home_crashgames',
  };

  const rails = HOME_RAILS.filter((rail) => {
    const flag = rail.source.kind === 'collection' ? RAIL_FLAGS[rail.source.slug] : null;
    return flag ? config.flag(flag) : true;
  });

  // Split on the ORIGINAL index rather than the filtered one: the Themes strip
  // belongs after "Exclusives", and counting into a list a flag has shortened
  // would drift it up the page every time an operator hid a rail.
  const themeAt = HOME_RAILS.slice(0, THEME_RAIL_INDEX).filter((rail) =>
    rails.includes(rail),
  ).length;

  return (
    <>
      {status === 'authenticated' && <HomeBanner />}
      {signedOut && <Hero />}
      {status === 'loading' && <AboveTheFoldSkeleton />}

      {signedOut && <ProviderRail />}

      {/* Renders nothing until a round settles — see `LatestWins`. It sits
          above the rails because that is where the reference puts it, and it
          costs no space while the feed is empty. */}
      {/* {config.flag('home_latestwins') && <LatestWins />} */}

      {rails.slice(0, themeAt).map((rail) => (
        <CatalogueRail key={rail.title} {...rail} />
      ))}

      <ThemeRail />

      {rails.slice(themeAt).map((rail) => (
        <CatalogueRail key={rail.title} {...rail} />
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
 *
 * Below `sm` the banner is a carousel, so the height is the card's 410px plus
 * the 16px gap and 8px dot row under it.
 */
function AboveTheFoldSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="min-h-[434px] sm:min-h-[300px] lg:min-h-[400px] xl:min-h-[514px]"
    />
  );
}
