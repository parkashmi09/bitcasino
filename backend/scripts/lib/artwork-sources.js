'use strict';

/**
 * Reference lobbies `fix-game-artwork.js` borrows tile art from, and the rules for calling
 * one of their games "the same game" as a `gisgamesnew` row (Slotegrator catalogue).
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE THREE CONDITIONS (all must hold, or the reference game is not used)
 *
 *   provider  through PROVIDERS below: our Slotegrator name ("PragmaticPlayLive",
 *             "Hacksaw Gaming", "Platipus2") against every name/slug the reference uses
 *   name      `nameKey` (case, ™ ® ©, "&" = "and", punctuation). Our names may carry an RTP
 *             or platform suffix ("Gladiator Legends 96% Mobile"); `nameKeys` also tries the
 *             name without it. Same game, same art.
 *   type      live or not (`rowIsLive`). Slotegrator's `type` says "blackjack", not "live
 *             blackjack", so live-only studios (Pragmatic Live, Ezugi, SA Gaming...) count as
 *             live unless the type is plainly RNG (slots, crash, scratch...).
 *
 * ── SOURCES (checked 2026-10-14) ───────────────────────────────────────────
 *
 *   own        FIRST. Our own DB's JSGames catalogue (js_games + aggregator='js_games' rows of
 *              gisgamesnew / gisgamesnew_parked), read once per run (`setOwnCatalogue`).
 *   hash.game  GET https://hash.game/api/game/home/detail/?gameUrl=<name>-by-<provider>&areaCode=IN
 *              `iconThreeFour`, exactly 3:4, resized by imgxcut `?_v=4,dpr=1,width=480`.
 *              `.../common.png` = no art. Never ask imgxcut for AVIF.
 *   shuffle    GET https://shuffle.com/main-api/bp-storage/public-assets/games/games.json
 *              (whole lobby once per run); imgix `?width=480&fm=jpg&q=85` = 480x672.
 *   powbet     GET https://powbet.com/en/api/v2/game/list?search=<name>&count=30
 *              `imagex3` 400x600 (2:3). `image` is landscape, not used.
 *   bitcasino  OFF by default (`--with-bitcasino`), and blocked. Its game search is
 *              POST https://bitcasino.io/graphql (`casinoGameInventory.searchGames`), but
 *              Cloudflare puts a bot challenge (403, `cf-mitigated: challenge`) in front of
 *              every scripted request. This source only ever uses plain Node fetch: on that
 *              403 it stops asking and every row gets the miss "bitcasino blocks scripted
 *              access (Cloudflare)". Running its API from a browser tab to bulk-read it would
 *              get around that protection; we don't. Using bitcasino needs an official feed
 *              or their permission.
 * ═════════════════════════════════════════════════════════════════════════
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/**
 * Slotegrator provider (lowercased) -> hash.game slugs, every name the references give it
 * (as `nameKey`; bitcasino's brand names included), and whether the studio
 * only makes live games.
 */
const PROVIDERS = {
  pragmaticplaylive: {
    hash: ['pragmatic-play', 'pragmatic-play-live'], // hash.game files the live tables under pragmatic-play
    names: ['pragmaticplaylive', 'pragmaticplay', 'pragmatic', 'pragmaticlive'],
    live: true,
  },
  'hacksaw gaming': { hash: ['hacksaw', 'hacksaw-gaming'], names: ['hacksawgaming', 'hacksaw'] }, // ✓ hacksaw
  'evolution gaming': {
    hash: ['evolution-gaming', 'evolution'],
    names: ['evolutiongaming', 'evolution', 'evolutionhubasia', 'evolutionasia'],
    live: true,
  },
  playtech: { hash: ['playtech', 'playtech-live'], names: ['playtech', 'playtechlive', 'playtechcasino'] },
  pgsoft: { hash: ['pg-soft', 'pgsoft'], names: ['pgsoft', 'pocketgamessoft'] },
  platipus2: { hash: ['platipus', 'platipus-gaming'], names: ['platipus', 'platipusgaming'] },
  bgaming: { hash: ['bgaming'], names: ['bgaming', 'bgmng'] }, // shuffle slug bgmng
  ezugi: { hash: ['ezugi'], names: ['ezugi'], live: true },
  'sa gaming': { hash: ['sa-gaming', 'sagaming'], names: ['sagaming', 'sa'], live: true },
  'sevenmojos slots': { hash: ['7mojos', '7-mojos', 'seven-mojos'], names: ['7mojos', 'sevenmojos', '7mojosslots', 'sevenmojosslots'] },
  inout: { hash: ['inout', 'inout-games', 'in-out'], names: ['inout', 'inoutgames', 'inoutdirect'] },
  iconic21: { hash: ['iconic21', 'iconic-21'], names: ['iconic21'], live: true }, // powbet: "Iconic 21"
  // powbet files Spribe's Aviator under the brand "Aviator" (code aviator).
  spribe: { hash: ['spribe'], names: ['spribe', 'aviator'] },
  betgames: { hash: ['betgames', 'betgames-tv'], names: ['betgames', 'betgamestv'], live: true },
  vivogaming: { hash: ['vivo-gaming', 'vivogaming'], names: ['vivogaming', 'vivo'], live: true },
  xprogaming: { hash: ['xprogaming', 'xpro-gaming', 'xpg'], names: ['xprogaming', 'xpro', 'xpg'], live: true },
  netent: { hash: ['netent'], names: ['netent', 'netentertainment'] }, // ✓ shuffle, powbet, JSGames netent

  // The rest of the live Slotegrator lobby (2026-10-20). hash.game slugs are its provider-list
  // names slugged (✓ = checked with a real game); [] = not on hash.game, so it is not asked.
  amigogaming: { hash: ['amigo-gaming'], names: ['amigogaming', 'amigo'] }, // ✓ powbet amigo-gaming
  apparat: { hash: [], names: ['apparat'] }, // powbet
  barbarabang: { hash: [], names: ['barbarabang'] }, // powbet
  'belatra games': { hash: ['belatra'], names: ['belatra', 'belatragames'] }, // ✓
  bfgames: { hash: [], names: ['bfgames', 'beefee'] }, // powbet "BF Games" / beefee
  booongo: { hash: ['booongo'], names: ['booongo', 'bng'] }, // ✓
  caleta: { hash: ['caleta-gaming'], names: ['caleta', 'caletagaming'] }, // ✓ powbet caleta
  ctinteractive: { hash: [], names: ['ctinteractive', 'ct'] }, // powbet "CT Interactive" / ct
  enjoygaming: { hash: [], names: ['enjoygaming'] }, // powbet
  fachai: { hash: ['fa-chai'], names: ['fachai'] }, // ✓
  fugaso: { hash: [], names: ['fugaso'] }, // powbet
  gamebeat: { hash: [], names: ['gamebeat'] }, // powbet
  'hollegames standard': { hash: [], names: ['hollegames', 'hollegamesstandard'] }, // powbet "Hölle Games"
  jdb: { hash: ['jdb', 'jdb-gaming'], names: ['jdb', 'jdbgaming'] }, // ✓
  'no limit city': { hash: ['nolimitcity'], names: ['nolimitcity', 'nolimit'] }, // ✓ shuffle, powbet nolimit
  onetouch: { hash: [], names: ['onetouch'] }, // shuffle, powbet
  onlyplay: { hash: ['onlyplay'], names: ['onlyplay'] }, // powbet
  playhub: { hash: [], names: ['playhub'] }, // powbet
  playngo: { hash: ['playngo'], names: ['playngo'] }, // ✓
  popiplay: { hash: ['popiplay'], names: ['popiplay'] }, // powbet
  quickspin: { hash: ['quickspin'], names: ['quickspin'] }, // ✓ powbet
  'relax gaming': { hash: [], names: ['relaxgaming', 'relax'] }, // shuffle
  'rtg slots': { hash: ['real-time-gaming'], names: ['rtgslots', 'rtg', 'realtimegaming'] },
  rubyplay: { hash: ['ruby-play'], names: ['rubyplay'] }, // powbet
  salsa: { hash: [], names: ['salsa', 'salsatechnology'] }, // powbet
  'skywind slot': { hash: ['skywind'], names: ['skywindslot', 'skywind', 'skywindgroup'] },
  spadegaming: { hash: ['spadegaming'], names: ['spadegaming'] }, // ✓ powbet
  thunderkick: { hash: ['thunderkick'], names: ['thunderkick'] }, // ✓ shuffle, powbet
  turbogames: { hash: [], names: ['turbogames'] }, // powbet
  vibragaming: { hash: [], names: ['vibragaming', 'vibraaleaplay'] }, // powbet "Vibra Gaming" / vibra-aleaplay
  yggdrasil: { hash: [], names: ['yggdrasil'] }, // powbet
  'zillion games': { hash: [], names: ['zilliongames', 'zillion', 'zilliondirect'] }, // powbet "Zillion" / zillion-direct
};

/** Lowercase, no ™ ® ©, "&" read as "and", only letters and digits. */
function nameKey(s) {
  return String(s || '')
    .replace(/[™®©]/g, '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/** Our name without an RTP / platform suffix: "Gladiator Legends 96% Mobile" -> "Gladiator Legends". */
function baseName(s) {
  return String(s || '')
    .replace(/\b\d{2}(?:[.,]\d+)?\s*%/g, ' ')
    .replace(/\b(mobile|desktop)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every key a reference name may equal for this row. */
function nameKeys(name) {
  return [...new Set([nameKey(name), nameKey(baseName(name))])].filter(Boolean);
}

/**
 * hash.game's slug of a name: "Rusty & Curly" -> "rusty-curly". It drops apostrophes
 * ("Pharaoh's" -> "pharaohs") but hyphenates some ("Drop'em" -> "drop-em"): `{ apostrophe: '-' }`.
 */
function slugOf(s, { and = false, apostrophe = '' } = {}) {
  return String(s || '')
    .replace(/[™®©]/g, '')
    .replace(/['’`]/g, apostrophe)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, and ? ' and ' : ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function providerOf(provider) {
  const key = String(provider || '').trim().toLowerCase();
  return PROVIDERS[key] || { hash: [slugOf(key)], names: [nameKey(key)] };
}

/** Whether a reference's provider name (or slug) is the row's provider. */
function sameProvider(ourProvider, theirs) {
  const k = nameKey(theirs);
  return Boolean(k) && providerOf(ourProvider).names.includes(k);
}

/** The catalogue `type` folded into a folder-sized category. */
function categoryOf(type) {
  const t = String(type || '').toLowerCase();
  if (/live|game.?show/.test(t)) return 'live';
  if (/slot/.test(t)) return 'slots';
  if (/table|roulette|card|poker|baccarat|blackjack|sic bo|dragon|teen|andar|classic/.test(t)) return 'table';
  if (/crash|dice|instant|arcade|casual|scratch|fish|lottery|keno|bingo/.test(t)) return 'instant';
  return 'other';
}

const isLive = (text) => /live|game.?show/i.test(String(text || ''));
const RNG_TYPE = /slot|crash|instant|scratch|casual|keno|bingo|arcade|fish/i;

/**
 * Whether a catalogue row is a live game. Its own type says so ("live dealer", "game show"),
 * or the studio only makes live games and neither the type nor the name says RNG
 * ("First Person Roulette" is Evolution's RNG table).
 */
function rowIsLive(row) {
  if (isLive(row.type)) return true;
  if (!providerOf(row.provider).live) return false;
  if (RNG_TYPE.test(String(row.type || ''))) return false;
  return !/\bfirst person\b|\brng\b/i.test(String(row.name || ''));
}

async function getJson(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { 'user-agent': UA, accept: 'application/json' } });
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return null;
}

/** hash.game: try each `<name>-by-<provider slug>` the row could have there. */
async function fromHash(row) {
  const keys = nameKeys(row.name);
  const names = [
    ...new Set(
      [row.name, baseName(row.name)].flatMap((n) => [slugOf(n), slugOf(n, { and: true }), slugOf(n, { apostrophe: '-' })])
    ),
  ].filter(Boolean);
  let seen = null;
  for (const p of providerOf(row.provider).hash) {
    for (const n of names) {
      const j = await getJson(`https://hash.game/api/game/home/detail/?gameUrl=${n}-by-${p}&areaCode=IN`);
      const d = j?.code === 0 ? j.data : null;
      if (!d) continue;
      seen = `${d.fullName} | ${d.providerName} | ${d.categoryName}`;
      if (!keys.includes(nameKey(d.fullName))) continue;
      if (!sameProvider(row.provider, d.providerName)) continue;
      if (isLive(d.categoryName) !== rowIsLive(row)) continue;
      const art = String(d.iconThreeFour || '');
      // Real art can have spaces in its file name ("1596_Jogo Do Bicho.png"); common.png means none.
      if (!/^https:\/\/imgxcut\.com\/game\/image\/[^/?#]+\.(png|jpe?g|webp)$/i.test(art) || /\/common\.png$/i.test(art)) continue;
      return { source: 'hash.game', url: `${encodeURI(decodeURI(art))}?_v=4,dpr=1,width=480`, matched: seen };
    }
  }
  return { miss: seen ? `hash.game had "${seen}", which did not match` : 'not on hash.game' };
}

/** powbet: search by name, keep a result that passes the three conditions. */
async function fromPowbet(row) {
  const keys = nameKeys(row.name);
  const results = [];
  for (const term of [...new Set([row.name, baseName(row.name)])]) {
    const j = await getJson(`https://powbet.com/en/api/v2/game/list?page=1&count=30&search=${encodeURIComponent(term)}`);
    if (Array.isArray(j?.result)) results.push(...j.result);
    if (results.length) break;
  }
  for (const g of results) {
    if (!keys.includes(nameKey(g.name))) continue;
    if (!sameProvider(row.provider, g.brand) && !sameProvider(row.provider, g.brand_code)) continue;
    const theirsLive = g.label === 'live' || (g.categories || []).some((c) => isLive(c));
    if (theirsLive !== rowIsLive(row)) continue;
    if (!g.imagex3) continue;
    return { source: 'powbet', url: new URL(g.imagex3, 'https://powbet.com').href, matched: `${g.name} | ${g.brand} | ${g.label || '-'}` };
  }
  return { miss: results.length ? 'powbet had no game matching all three' : 'not on powbet' };
}

let shuffleIndex = null;
function shuffleGames() {
  shuffleIndex ||= getJson('https://shuffle.com/main-api/bp-storage/public-assets/games/games.json').then((list) => {
    const byName = new Map();
    for (const g of Array.isArray(list) ? list : []) {
      const k = nameKey(g.name);
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(g);
    }
    return byName;
  });
  return shuffleIndex;
}

/** shuffle: the same name in its lobby file, then the other two conditions. */
async function fromShuffle(row) {
  const index = await shuffleGames();
  const candidates = nameKeys(row.name).flatMap((k) => index.get(k) || []);
  for (const g of candidates) {
    if (!sameProvider(row.provider, g.provider?.name) && !sameProvider(row.provider, g.provider?.slug)) continue;
    const cats = (g.gameAndGameCategories || []).map((c) => c.gameCategoryName);
    const theirsLive = cats.some((c) => c === 'LIVE_CASINO' || c === 'GAME_SHOWS');
    if (theirsLive !== rowIsLive(row)) continue;
    if (!g.image?.key) continue;
    return {
      source: 'shuffle',
      url: `https://shuffle-com.imgix.net/${g.image.key}?width=480&fm=jpg&q=85`,
      matched: `${g.name} | ${g.provider?.name} | ${cats.join('/')}`,
    };
  }
  return { miss: candidates.length ? 'shuffle had the name, not the provider/type' : 'not on shuffle' };
}

/** A bitcasino art URL as https, with its spaces / "+" encoded once. */
function bitcasinoUrl(u) {
  let s = String(u || '').trim();
  if (!/^(https?:)?\/\//.test(s)) return null;
  if (s.startsWith('//')) s = `https:${s}`;
  s = s.replace(/^http:/, 'https:');
  try {
    return encodeURI(decodeURI(s));
  } catch {
    return encodeURI(s);
  }
}

const BITCASINO_BLOCKED = 'bitcasino blocks scripted access (Cloudflare)';
const BITCASINO_QUERY = `query SearchGames($searchTerm: String!, $site: String!, $countryCode: String, $first: Int, $offset: Int) {
  casinoGameInventory { searchGames(searchTerm: $searchTerm, site: $site, countryCode: $countryCode, first: $first, offset: $offset) {
    results { ... on CasinoGameInventoryGame { name href thumbUrl thumbUrlTab provider { name handle } menuItem(section: 1) { name } category { name } } }
  } }
}`;
let bitcasinoBlocked = false;

/**
 * bitcasino: plain Node POST of its own search query. Off by default; Cloudflare challenges
 * Node, so in practice this returns BITCASINO_BLOCKED after one request and never retries.
 * If it ever answers (an official feed or allow-listing), the match rules are the same as the
 * other sources: `menuItem` brand / provider, nameKey, live = category "Live ...".
 * `thumbUrlTab` is portrait; `thumbUrl` (490x368) is landscape and only marked as such.
 */
async function fromBitcasino(row) {
  if (bitcasinoBlocked) return { miss: BITCASINO_BLOCKED };
  let res;
  try {
    res = await fetch('https://bitcasino.io/graphql', {
      method: 'POST',
      signal: AbortSignal.timeout(20_000),
      headers: { 'user-agent': UA, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        query: BITCASINO_QUERY,
        variables: { searchTerm: baseName(row.name), site: 'bitcasino', countryCode: 'CA', first: 20, offset: 0 },
      }),
    });
  } catch (err) {
    return { miss: `bitcasino unreachable (${err.name})` };
  }
  if (res.status === 403 && /challenge|managed|block/i.test(res.headers.get('cf-mitigated') || 'challenge')) {
    await res.body?.cancel();
    bitcasinoBlocked = true;
    return { miss: BITCASINO_BLOCKED };
  }
  if (!res.ok) {
    await res.body?.cancel();
    return { miss: `bitcasino HTTP ${res.status}` };
  }
  const results = (await res.json().catch(() => null))?.data?.casinoGameInventory?.searchGames?.results || [];
  const keys = nameKeys(row.name);
  for (const g of results) {
    if (!g?.name || !keys.includes(nameKey(g.name))) continue;
    if (![g.menuItem?.[0]?.name, g.provider?.name, g.provider?.handle].some((x) => sameProvider(row.provider, x))) continue;
    if (isLive(g.category?.name) !== rowIsLive(row)) continue;
    const tall = bitcasinoUrl(g.thumbUrlTab);
    const wide = bitcasinoUrl(g.thumbUrl);
    if (!tall && !wide) continue;
    return {
      source: 'bitcasino',
      url: tall || wide,
      matched: `${g.name} | ${g.menuItem?.[0]?.name || g.provider?.name} | ${g.category?.name}`,
      ...(tall ? {} : { landscape: true }),
    };
  }
  return { miss: results.length ? 'bitcasino had no game matching all three' : 'not on bitcasino' };
}

/**
 * A catalogue the user exported from their own browser (for example bitcasino's lobby, which
 * blocks scripts), passed as `--import=<file>`: JSON `[{ name, provider, category, image }]`.
 * Same three conditions; `image` must be portrait (the script measures it).
 */
function importSource(list) {
  if (!Array.isArray(list) || !list.length) return null;
  const byName = new Map();
  for (const g of list) {
    const k = nameKey(g?.name);
    if (!k) continue;
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(g);
  }
  return async function fromImport(row) {
    const candidates = nameKeys(row.name).flatMap((k) => byName.get(k) || []);
    for (const g of candidates) {
      if (!sameProvider(row.provider, g.provider)) continue;
      if (isLive(g.category) !== rowIsLive(row)) continue;
      const url = bitcasinoUrl(g.image);
      if (!url) continue;
      return { source: 'import', url, matched: `${g.name} | ${g.provider} | ${g.category}` };
    }
    return { miss: candidates.length ? 'import had the name, not the provider/type' : 'not in import' };
  };
}

/**
 * Our own DB first: the same game in the JSGames catalogue (`js_games`, and `gisgamesnew` /
 * `gisgamesnew_parked` rows with aggregator='js_games'). fix-game-artwork.js reads those rows
 * once over its own connection and hands them to `setOwnCatalogue`, curated rows first.
 * JSGames providers are short vendor keys (evolution, pragmaticlive, hacksaw, netent...) found in
 * PROVIDERS' `names`; its `type` says live ("CasinoLive"). Only absolute https art is used.
 */
let ownIndex = null;
function setOwnCatalogue(rows) {
  ownIndex = new Map();
  for (const g of rows || []) {
    const k = nameKey(g?.name);
    if (!k || !/^https:\/\//i.test(String(g.image || '').trim())) continue;
    if (!ownIndex.has(k)) ownIndex.set(k, []);
    ownIndex.get(k).push(g);
  }
  return ownIndex.size;
}

async function fromOwnCatalogue(row) {
  if (!ownIndex) return { miss: 'own catalogue not loaded' };
  const candidates = nameKeys(row.name).flatMap((k) => ownIndex.get(k) || []);
  for (const g of candidates) {
    if (!sameProvider(row.provider, g.provider)) continue;
    if (isLive(g.type) !== rowIsLive(row)) continue;
    return { source: 'own', url: String(g.image).trim(), matched: `${g.name} | ${g.provider} | ${g.type}` };
  }
  return { miss: candidates.length ? 'own catalogue had the name, not the provider/type' : 'not in own catalogue' };
}

/** Own DB first, then best art: hash.game is exactly 3:4, shuffle 5:7, powbet 2:3. fromBitcasino joins last only with --with-bitcasino. */
const SOURCES = [fromOwnCatalogue, fromHash, fromShuffle, fromPowbet];

module.exports = {
  UA,
  PROVIDERS,
  SOURCES,
  setOwnCatalogue,
  fromOwnCatalogue,
  fromBitcasino,
  importSource,
  BITCASINO_BLOCKED,
  bitcasinoUrl,
  nameKey,
  nameKeys,
  baseName,
  slugOf,
  providerOf,
  sameProvider,
  categoryOf,
  isLive,
  rowIsLive,
};
