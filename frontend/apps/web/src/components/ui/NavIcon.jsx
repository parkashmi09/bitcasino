import { ASSETS } from '@/data/assets.generated';
import { cn } from '@/lib/cn';

/**
 * Navigation icons.
 *
 * The reference renders these as 20x20 raster/vector images from its CMS, not
 * as inline glyphs — each one is a small full-colour illustration, which is
 * what makes the category list scannable. We serve the same files out of
 * /images/categories (see scripts/place-assets.mjs).
 *
 * The keys of SRC below are the complete set of valid `name` values.
 */

/** Our nav slugs to the CMS icon filenames, which use their own names. */
const SRC = {
  originals: ASSETS.navIcons.originals,
  'new-releases': ASSETS.navIcons['new-releases'],
  'live-rtp': ASSETS.navIcons['live-rtp'],
  promotions: ASSETS.navIcons.promotions,
  tournaments: ASSETS.navIcons.tournaments,
  providers: ASSETS.navIcons.providers,
  'live-casino': ASSETS.navIcons['all-live-casino'],
  live: ASSETS.navIcons['all-live-casino'],
  'live-exclusive': ASSETS.navIcons['live-exclusives'],
  vip: ASSETS.navIcons.crown,
  baccarat: ASSETS.navIcons.baccarat,
  blackjack: ASSETS.navIcons.blackjack,
  roulette: ASSETS.navIcons.roulette,
  'table-games': ASSETS.navIcons['table-games'],
  slots: ASSETS.navIcons.slots,
  'bitcasino-exclusive': ASSETS.navIcons.originals,
  crash: ASSETS.navIcons['crash-instant-win'],
  'game-shows': ASSETS.navIcons['game-shows'],
  jackpots: ASSETS.navIcons.jackpots,
  'bonus-buy': ASSETS.navIcons['bonus-buys-1'],
  'all-games': ASSETS.navIcons['all-games'],

  /* The account menu's rows. Same CMS directory as everything above —
     `cms/icons/icon_*.png`, read off the reference's own account panel — so
     they are the same 20px full-colour illustrations at the same weight, not
     a second icon style bolted onto the first. `notifications` is their
     `icon_promotions`, which the reference uses for both. */
  loyalty: ASSETS.navIcons.loyalty,
  rewards: ASSETS.navIcons['bonus-buys'],
  boosts: ASSETS.navIcons.boosts,
  account: ASSETS.navIcons.account,
  security: ASSETS.navIcons.security,
  notifications: ASSETS.navIcons.promotions,
  'refer-a-friend': ASSETS.navIcons['refer-a-friend'],
  logout: ASSETS.navIcons.logout,
};

/** `size` is the rendered size in px; 20 matches the reference's nav. */
export function NavIcon({ name, size = 20, className }) {
  return (
    <img
      src={SRC[name]}
      alt=""
      width={size}
      height={size}
      decoding="async"
      aria-hidden="true"
      className={cn('shrink-0 object-contain', className)}
      style={{ width: size, height: size }}
    />
  );
}
