import { describe, expect, it } from 'vitest';

import {
  categoryFromType,
  typeForCategory,
  isCategorySlug,
  queryTypesFor,
  CATEGORY_SLUGS,
} from './categories';
import { toGame, toGames, toRecentGames, sortValue } from './games';
import {
  providerSlug,
  toProvider,
  toProviders,
  toProviderCounts,
  nameForSlug,
} from './providers';
import { toSiteConfig } from './siteConfig';
import {
  PLATFORM_COLLECTIONS,
  CUT_COLLECTIONS,
  resolveCollection,
} from './collections';
import { CATEGORIES } from '../categories';

/**
 * The adapters, against the shapes the platform actually answers.
 *
 * The fixtures below are copied from live responses on 2026-09-09 rather than
 * invented, because the failure this file exists to catch is the one where a
 * field is renamed upstream and the mapping quietly produces `undefined` —
 * which renders as nothing at all rather than as an error. A fixture written
 * from imagination cannot catch that; one copied from the wire can.
 */

/** `GET /casino/games` — the full row: parameters, images and label all present. */
const FULL_ROW = {
  uuid: 'amber-lodge',
  name: 'Amber Lodge',
  provider: 'Tidewater Gaming',
  provider_id: null,
  type: 'table-games',
  image: '/images/games/amber-lodge.svg',
  technology: 'html5',
  has_lobby: false,
  is_mobile: true,
  has_freespins: false,
  freespin_valid_until_full_day: false,
  label: 'exclusive',
  parameters: { rtp: 94.8, hitRatio: 43.8, volatility: 'high' },
  tags: null,
  images: {
    portrait: '/images/games/amber-lodge.svg',
    landscape: '/images/games/amber-lodge-wide.svg',
  },
  created_at: '2026-09-09T02:11:02.599Z',
  updated_at: 1788939662632,
};

/** `GET /casino/games/search` — the lean row. No parameters, images or label. */
const LEAN_ROW = {
  uuid: 'cobalt-sky',
  name: 'Cobalt Sky',
  provider: 'Lumen Games',
  image: '/images/games/cobalt-sky.svg',
  type: 'crash',
  is_mobile: true,
  has_freespins: false,
};

/** An in-house original, as the Phase 0 seeder writes it. */
const IN_HOUSE_ROW = {
  uuid: 'plinko',
  name: 'Plinko',
  provider: 'In-House',
  type: 'originals',
  image: '/images/categories/originals.png',
  has_lobby: false,
  is_mobile: true,
  label: null,
  parameters: { inHouse: true, event: 'plinko' },
  images: {},
};

describe('categories', () => {
  it('maps every one of our slugs round-trip', () => {
    for (const slug of CATEGORY_SLUGS) {
      expect(categoryFromType(typeForCategory(slug))).toBe(slug);
    }
  });

  it('folds case and separators, so a sync writing Live_Casino still lands', () => {
    expect(categoryFromType('Live_Casino')).toBe('live-casino');
    expect(categoryFromType('live casino')).toBe('live-casino');
    expect(categoryFromType('  LIVE-CASINO  ')).toBe('live-casino');
  });

  it('returns null for an unknown type rather than guessing a category', () => {
    // A wrong category is worse than an absent one: the player cannot tell.
    expect(categoryFromType('virtual_sports')).toBeNull();
    expect(categoryFromType('')).toBeNull();
    expect(categoryFromType(undefined)).toBeNull();
  });

  it('guards the /categories/:slug route', () => {
    expect(isCategorySlug('crash')).toBe(true);
    expect(isCategorySlug('CRASH')).toBe(true);
    expect(isCategorySlug('sportsbook')).toBe(false);
  });

  it('falls back to the slug for a category with no alias yet', () => {
    expect(typeForCategory('megaways')).toBe('megaways');
    expect(queryTypesFor('megaways')).toEqual(['megaways']);
  });

  it('lists every upstream type behind one of our slugs', () => {
    expect(queryTypesFor('crash')).toEqual(['crash']);
  });
});

describe('toGame', () => {
  it('maps the full row onto the Game shape the components read', () => {
    expect(toGame(FULL_ROW)).toEqual({
      id: 'amber-lodge',
      slug: 'amber-lodge',
      title: 'Amber Lodge',
      provider: 'Tidewater Gaming',
      category: 'table-games',
      thumb: '/images/games/amber-lodge.svg',
      thumbWide: '/images/games/amber-lodge-wide.svg',
      badge: 'exclusive',
      rtp: 94.8,
      volatility: 'high',
      hitRatio: 43.8,
      hasLobby: false,
    });
  });

  it('renders a lean search row, falling back to the portrait for thumbWide', () => {
    const game = toGame(LEAN_ROW);

    expect(game.title).toBe('Cobalt Sky');
    expect(game.category).toBe('crash');
    // Wrong aspect ratio, visibly better than a hole in the featured rail.
    expect(game.thumbWide).toBe('/images/games/cobalt-sky.svg');
    expect(game.badge).toBeUndefined();
  });

  it('leaves absent stats undefined, never 0', () => {
    const game = toGame(LEAN_ROW);

    // 0 would sort the whole catalogue to the bottom while claiming to know
    // its RTP. `GameList` reads undefined as "cannot sort on this".
    expect(game.rtp).toBeUndefined();
    expect(game.hitRatio).toBeUndefined();
    expect(game.volatility).toBeUndefined();
  });

  it('drops a label that is not one of the four the UI renders', () => {
    expect(toGame({ ...FULL_ROW, label: 'megaways' }).badge).toBeUndefined();
    expect(toGame({ ...FULL_ROW, label: null }).badge).toBeUndefined();
  });

  it('marks in-house originals so Play can pick the socket path', () => {
    const game = toGame(IN_HOUSE_ROW);

    expect(game.inHouse).toBe(true);
    expect(game.event).toBe('plinko');
    expect(game.category).toBe('originals');
  });

  it('does not mark an aggregator game as in-house', () => {
    expect(toGame(FULL_ROW).inHouse).toBeUndefined();
    expect(toGame(FULL_ROW).event).toBeUndefined();
  });

  it('substitutes category art when the catalogue carries no image', () => {
    // A real sync leaves `image` null for titles whose art has not been
    // fetched. An empty src is a broken-image glyph in every browser.
    //
    // Note the file is NOT `crash.png` — deriving the path from the slug was
    // the original bug here, and three of the seven categories are served
    // from a differently named file.
    const game = toGame({ ...LEAN_ROW, image: null });
    expect(game.thumb).toBe('/images/categories/crash-instant-win.png');
  });

  it('falls back to originals art for a category it does not recognise', () => {
    const game = toGame({ ...LEAN_ROW, type: 'virtual_sports', image: null });
    expect(game.thumb).toBe('/images/categories/originals.png');
  });

  it('keeps an unmapped type renderable with a null category', () => {
    const game = toGame({ ...LEAN_ROW, type: 'virtual_sports' });

    // It must still render — dropping it would silently shrink a rail.
    expect(game.category).toBeNull();
    expect(game.title).toBe('Cobalt Sky');
    expect(game.thumb).toBe('/images/games/cobalt-sky.svg');
  });

  it('rejects a row with no uuid — everything downstream keys on it', () => {
    expect(toGame({ name: 'No id' })).toBeNull();
    expect(toGame(null)).toBeNull();
    expect(toGame('nope')).toBeNull();
  });

  it('coerces numeric strings and refuses values that are not numbers', () => {
    const game = toGame({
      ...FULL_ROW,
      parameters: { rtp: '96.1', hitRatio: 'n/a', volatility: 'extreme' },
    });

    expect(game.rtp).toBe(96.1);
    expect(game.hitRatio).toBeUndefined();
    expect(game.volatility).toBeUndefined();
  });
});

describe('toGames', () => {
  it('drops unrenderable rows instead of failing the whole list', () => {
    expect(toGames([FULL_ROW, null, { name: 'no uuid' }, LEAN_ROW])).toHaveLength(2);
  });

  it('answers an empty array for anything that is not a list', () => {
    // A failed read must not throw here — the query layer owns that state.
    expect(toGames(null)).toEqual([]);
    expect(toGames({ rows: [] })).toEqual([]);
    expect(toGames(undefined)).toEqual([]);
  });
});

describe('toRecentGames', () => {
  it('unwraps the nested game', () => {
    const games = toRecentGames([
      { game_uuid: 'amber-lodge', played_at: '2026-09-09T00:00:00Z', game: FULL_ROW },
    ]);

    expect(games).toHaveLength(1);
    expect(games[0].title).toBe('Amber Lodge');
  });

  it('drops a title that has left the catalogue', () => {
    // `game` is null for a uuid the catalogue no longer holds. A tile that
    // cannot be launched does not belong in a "play again" list.
    const games = toRecentGames([
      { game_uuid: 'gone', played_at: '2026-09-09T00:00:00Z', game: null },
      { game_uuid: 'amber-lodge', played_at: '2026-09-09T00:00:00Z', game: FULL_ROW },
    ]);

    expect(games).toHaveLength(1);
    expect(games[0].slug).toBe('amber-lodge');
  });
});

describe('sortValue', () => {
  it('ranks volatility rather than sorting it alphabetically', () => {
    const low = { volatility: 'low' };
    const high = { volatility: 'high' };

    // Alphabetically 'high' < 'low', which would invert the control.
    expect(sortValue(high, 'volatility')).toBeGreaterThan(sortValue(low, 'volatility'));
  });

  it('returns undefined for a game the platform carries no stats for', () => {
    expect(sortValue(toGame(LEAN_ROW), 'rtp')).toBeUndefined();
    expect(sortValue(toGame(LEAN_ROW), 'volatility')).toBeUndefined();
    expect(sortValue({}, 'hitRatio')).toBeUndefined();
  });
});

describe('providers', () => {
  const ROWS = [
    { name: 'Tidewater Gaming' },
    { name: 'In-House' },
    { name: 'Foxglove Labs' },
  ];

  const COUNTS = toProviderCounts([
    { provider: 'In-House', game_count: 20 },
    { provider: 'Foxglove Labs', game_count: '3' },
  ]);

  it('derives a slug rather than needing a hand-written table', () => {
    expect(providerSlug('Tidewater Gaming')).toBe('tidewater-gaming');
    expect(providerSlug('In-House')).toBe('in-house');
    expect(providerSlug("Bob's Games & Co.")).toBe('bob-s-games-co');
  });

  it('coerces a bigint count that arrived as a string', () => {
    expect(COUNTS['Foxglove Labs']).toBe(3);
    expect(COUNTS['In-House']).toBe(20);
  });

  it('builds a Provider from a name alone', () => {
    expect(toProvider({ name: 'In-House' }, COUNTS)).toEqual({
      id: 'in-house',
      name: 'In-House',
      slug: 'in-house',
      // Aliased: there is no `in-house.svg`, and In-House is not a studio.
      logo: '/images/providers/bitcasino-originals.svg',
      gameCount: 20,
    });
  });

  it('resolves a logo whose file is not named after the derived slug', () => {
    // The slug is `northlight-studio`; the art is `northlight.svg`. Deriving
    // the filename was the original bug — five of nine studios 404ed.
    expect(toProvider({ name: 'Northlight Studio' }).logo)
      .toBe('/images/providers/northlight.svg');
    expect(toProvider({ name: 'Tidewater Gaming' }).logo)
      .toBe('/images/providers/tidewater.svg');
  });

  it('answers null for a studio we have no art for, never a 404 path', () => {
    // A real sync brings hundreds of studios with no local art. Emitting a
    // plausible-looking path just moves the 404 somewhere harder to find; the
    // renderer decides what a logo-less studio looks like.
    expect(toProvider({ name: 'Pragmatic Play Live' }).logo).toBeNull();
    expect(toProvider({ name: 'Some New Studio' }).logo).toBeNull();
  });

  it('renders a studio with no count rather than omitting it', () => {
    // The counts query is allowed to fail on its own; a grid of studios with
    // no counts is a working page.
    expect(toProvider({ name: 'Tidewater Gaming' }, COUNTS).gameCount).toBe(0);
    expect(toProvider({ name: 'Tidewater Gaming' }).gameCount).toBe(0);
  });

  it('sorts alphabetically and drops nameless rows', () => {
    const providers = toProviders([...ROWS, { name: '' }, null], COUNTS);

    expect(providers.map((p) => p.name)).toEqual([
      'Foxglove Labs',
      'In-House',
      'Tidewater Gaming',
    ]);
  });

  it('resolves a URL slug back to the name the API takes', () => {
    const providers = toProviders(ROWS, COUNTS);

    expect(nameForSlug('tidewater-gaming', providers)).toBe('Tidewater Gaming');
    expect(nameForSlug('In-House', providers)).toBe('In-House');
  });

  it('returns null for an unknown slug instead of guessing a name', () => {
    // A guess would ask the API for a provider that does not exist and render
    // an empty catalogue as though the studio had no games.
    expect(nameForSlug('northlight', toProviders(ROWS, COUNTS))).toBeNull();
    expect(nameForSlug('', toProviders(ROWS))).toBeNull();
    expect(nameForSlug('tidewater-gaming', undefined)).toBeNull();
  });
});

describe('site config', () => {
  it('reads every flag as ON before anything has been fetched', () => {
    // Matches the backend, which answers all-true for a missing config row.
    // Defaulting off would assemble the home page in front of the player.
    const config = toSiteConfig(null);

    expect(config.flag('casino')).toBe(true);
    expect(config.flag('home_heroSection')).toBe(true);
    expect(config.flag('a_flag_that_does_not_exist')).toBe(true);
    expect(config.configured).toBe(false);
  });

  it('turns something off only on an explicit false', () => {
    const config = toSiteConfig({ casino: true, lotto: false, vipclub: 0, bonus: '0' });

    expect(config.flag('casino')).toBe(true);
    expect(config.flag('lotto')).toBe(false);
    expect(config.flag('vipclub')).toBe(false);
    expect(config.flag('bonus')).toBe(false);
  });

  it('keeps public amounts as the decimal strings they arrived as', () => {
    const config = toSiteConfig({ registerbonus: '0.00000000' });

    // Number('0.00000000') renders as '0', which is a different promise.
    expect(config.amount('registerbonus')).toBe('0.00000000');
    expect(config.amount('missing')).toBe('0');
  });

  it('intersects site flags with the wallet allow-list, in the wallet order', () => {
    const config = toSiteConfig({ usdt: true, btc: false, inr: true, eth: true });

    expect(config.enabledCurrencies(['USDT', 'BTC', 'ETH', 'INR'])).toEqual([
      'USDT',
      'ETH',
      'INR',
    ]);
  });

  it('reports configured only when a row actually exists', () => {
    expect(toSiteConfig({ configured: true }).configured).toBe(true);
    expect(toSiteConfig({ configured: false }).configured).toBe(false);
    expect(toSiteConfig({}).configured).toBe(false);
  });
});

/**
 * The `/games/:slug` collection registry.
 *
 * Two of the five platform slugs are ALSO category slugs, and the two name
 * different lists. That collision is the thing most likely to be broken by a
 * later edit, so it is asserted from both directions.
 */
describe('collections', () => {
  it('resolves the five rows the platform curates', () => {
    for (const { slug, label } of PLATFORM_COLLECTIONS) {
      const target = resolveCollection(slug);
      expect(target.kind).toBe('collection');
      expect(target.label).toBe(label);
    }
  });

  it('resolves the three this site cuts client-side', () => {
    for (const slug of ['new', 'exclusives', 'live-rtp']) {
      expect(resolveCollection(slug).kind).toBe('cut');
    }
  });

  it('prefers the curated row for a slug that is also a category', () => {
    // `/games/live-casino` is the curated row, and so is `/games/crash`. The
    // CATEGORY versions live at `/categories/:slug`, which never calls this —
    // App.jsx passes `mode` so the two routes cannot collide.
    expect(resolveCollection('live-casino').kind).toBe('collection');
    expect(resolveCollection('crash').kind).toBe('collection');
  });

  it('resolves a category-only slug reached through /games', () => {
    expect(resolveCollection('originals').kind).toBe('category');
    expect(resolveCollection('jackpots').kind).toBe('category');
  });

  it('answers null for a slug this site does not serve', () => {
    expect(resolveCollection('sportsbook')).toBeNull();
    expect(resolveCollection('')).toBeNull();
    expect(resolveCollection(undefined)).toBeNull();
  });

  it('cuts new and exclusives by badge', () => {
    const games = [
      { id: '1', badge: 'new' },
      { id: '2', badge: 'exclusive' },
      { id: '3' },
      { id: '4', badge: 'hot' },
    ];

    expect(CUT_COLLECTIONS.new.cut(games).map((g) => g.id)).toEqual(['1']);
    expect(CUT_COLLECTIONS.exclusives.cut(games).map((g) => g.id)).toEqual(['2']);
  });

  it('drops games with no RTP from live-rtp rather than sorting them', () => {
    // A list titled "Live RTP" must not contain rows whose RTP nobody knows,
    // and sorting undefined leaves them wherever the engine happens to.
    const games = [
      { id: 'a', rtp: 94 },
      { id: 'b' },
      { id: 'c', rtp: 97.2 },
    ];

    expect(CUT_COLLECTIONS['live-rtp'].cut(games).map((g) => g.id)).toEqual(['c', 'a']);
  });

  it('every category the nav offers has a type mapping', () => {
    // A category listed in the UI with no mapping renders a nav entry whose
    // page can never have anything in it.
    expect(CATEGORIES.map((c) => c.slug)).toEqual([...CATEGORY_SLUGS]);
  });
});
