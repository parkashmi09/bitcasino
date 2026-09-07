import { Hero } from '@/components/sections/Hero';
import { GameRail } from '@/components/sections/GameRail';
import { ThemeRail } from '@/components/sections/ThemeRail';
import { TrustSection } from '@/components/sections/TrustSection';
import { ProviderRail } from '@/components/sections/ProviderRail';
import { Testimonials } from '@/components/sections/Testimonials';
import { HOME_RAILS, THEME_RAIL_INDEX } from '@/data/catalog';

/**
 * Section order follows the reference home page.
 *
 * Two structural details matter. The studio strip sits immediately under the
 * hero, where it reads as a credibility signal rather than navigation. And
 * every game rail then runs consecutively, with all editorial content below
 * them — the rails are never interleaved with marketing.
 *
 * The reference folds the whole editorial tail (trust, game breakdown,
 * providers, promotions, the crypto explainer and the getting-started guide)
 * into `TrustSection`'s single collapsed panel rather than a run of separate
 * bands. `CategoryStrip`, `SeoContent`, `PromoGrid`, `VipBanner`,
 * `CryptoFeatures`, `AccessAnywhere` and `GettingStarted` still exist as
 * components, but the home page no longer renders them.
 */
export function Home() {
  const railsBeforeThemes = HOME_RAILS.slice(0, THEME_RAIL_INDEX);
  const railsAfterThemes = HOME_RAILS.slice(THEME_RAIL_INDEX);

  return (
    <>
      <Hero />
      <ProviderRail />

      {railsBeforeThemes.map((rail, i) => (
        <GameRail key={rail.title} {...rail} featured={i === 0} />
      ))}

      <ThemeRail />

      {railsAfterThemes.map((rail) => (
        <GameRail key={rail.title} {...rail} />
      ))}

      <TrustSection />
      <Testimonials />
    </>
  );
}
