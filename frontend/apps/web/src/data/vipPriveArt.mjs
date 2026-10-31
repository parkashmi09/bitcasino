/**
 * Where each `/themes/vip-prive` tile's artwork comes from.
 *
 * Catalogue slug -> the path under `heathmont.imgix.net` that the reference's
 * own VIP Prive page loads for that table. `scripts/fetch-vip-prive.mjs` reads
 * this and writes `public/images/games/<slug>.avif`; nothing in the app reads
 * it at runtime, which is why it is a `.mjs` beside the data rather than part
 * of `catalog.js`.
 *
 * It lives here, and not in `scripts/`, so that the one list naming these
 * twenty tables sits next to the one list naming their titles. A slug added to
 * `VIP_PRIVE` in `catalog.js` without an entry here has no art, and
 * `npm run verify:api` is where that is caught.
 *
 * The sources are not one directory. Three are older captures (`8io new
 * thumbs/`, `8.io new thumbs vol2/`) and the rest are the 2026 set, whose
 * directory name really does end in a space — `Prive game tiles - Evo /`. They
 * are written here verbatim and escaped at fetch time.
 *
 * Nineteen entries, not twenty. `exclusive-salon-prive-baccarat` is on the
 * reference's VIP Prive page AND its Live Exclusives page, and it is one
 * catalogue row either way — `LIVE_EXCLUSIVES` already carries it with its own
 * captured art, and both themes simply name the same slug.
 */
export const VIP_PRIVE_ART = Object.freeze({
  'salon-prive-blackjack-a': '8io new thumbs/SalonPriveBlackjack1-evolution.jpg',
  'salon-prive-lobby': '8.io new thumbs vol2/Evolution/Salon prive lobby.png',
  'salon-prive-blackjack-f':
    'bitcasino/images/2026-promo-banners/Prive game tiles - Evo /SP BJ F.png',
  'salon-prive-baccarat-d':
    'bitcasino/images/2026-promo-banners/Prive game tiles - Evo /SP baccarat D.png',
  'salon-prive-blackjack-g':
    'bitcasino/images/2026-promo-banners/Prive game tiles - Evo /SP BJ G.png',
  'salon-prive-blackjack-h':
    'bitcasino/images/2026-promo-banners/Prive game tiles - Evo /SP BJ H.png',
  'salon-prive-baccarat': '8io new thumbs/SalonPriveBaccarat-evolution.jpg',
  'salon-prive-blackjack-i':
    'bitcasino/images/2026-promo-banners/Prive game tiles - Evo /SP BJ I.png',
  'salon-prive-auto-roulette-b':
    'bitcasino/images/2026-promo-banners/Prive game tiles - Evo /SP auto A.png',
  'salon-prive-blackjack-j':
    'bitcasino/images/2026-promo-banners/Prive game tiles - Evo /SP BJ J.png',
  'salon-prive-blackjack-k':
    'bitcasino/images/2026-promo-banners/Prive game tiles - Evo /SP BJ K.png',
  'salon-prive-blackjack-l':
    'bitcasino/images/2026-promo-banners/Prive game tiles - Evo /SP BJ L.png',
  'salon-prive-blackjack-m':
    'bitcasino/images/2026-promo-banners/Prive game tiles - Evo /SP BJ M.png',
  'salon-prive-blackjack-c': '8io new thumbs/SalonPriveBlackjack2-evolution.jpg',
  'korean-salon-prive-baccarat':
    'bitcasino/images/2026-promo-banners/Prive game tiles - Evo /Korean SP Baccarat.png',
  'salon-prive-blackjack-d':
    'bitcasino/images/2026-promo-banners/Prive game tiles - Evo /Salon Prive BJ D.png',
  'salon-prive-roulette':
    'bitcasino/images/2026-promo-banners/Prive game tiles - Evo /SP roulette.png',
  'salon-prive-blackjack-e':
    'bitcasino/images/2026-promo-banners/Prive game tiles - Evo /SP BJ E.png',
  'salon-prive-baccarat-c':
    'bitcasino/images/2026-promo-banners/Prive game tiles - Evo /SP baccar C.png',
});
