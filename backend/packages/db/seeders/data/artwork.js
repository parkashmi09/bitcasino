'use strict';

/**
 * Game artwork: which catalogue URLs a browser can draw, and where the art of the rest is.
 *
 * Shared by seeder 004 (fresh installs), migration 092 (databases 004 already filled) and
 * `scripts/recover-game-artwork.js` (which builds `recovered-artwork.json`).
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY 945 OF 1,980 GAMES HAD NO PICTURE
 *
 * The dump's `game_icon` is a hotlink into other operators' CDNs. Seeder 004 kept the
 * hosts that render and set the rest to NULL. Not all of what it dropped was dead art:
 *
 *   boxbet.io          129 rows. `boxbet.io/_next/image?url=<encoded>` is Next's image
 *                      proxy, which answers an HTML page to a hotlink. The URL inside it
 *                      is `cdn.softswiss.net/i/s6/<studio>/<Name>.png`, which renders.
 *   drive.google.com    97 rows (all 2j). NOT recoverable by a link: `uc?export=view`
 *                      serves the file to curl but answers 403 to a browser's image
 *                      request (`Sec-Fetch-Dest: image`), as do `lh3` and `thumbnail`.
 *                      These games need their art self-hosted.
 *   bc.imgix.net etc.  `bc.imgix.net` answers 402, `rollbit.com` and `luckyblock.com` do
 *                      not answer at all, and 313 rows have no URL. Most of these games
 *                      are BGaming / NetEnt / Evolution titles, whose art the same
 *                      softswiss CDN serves under the game's own name.
 *
 * The recovered URLs are not guessed at serve time. The script tries each candidate with
 * a browser GET (user agent, Referer and `Sec-Fetch-Dest: image`, as an `<img>` asks) and writes only the ones that
 * answered 200 with an image into `recovered-artwork.json`, keyed by `game_uid`.
 * ═════════════════════════════════════════════════════════════════════════
 */

const fs = require('node:fs');
const path = require('node:path');

const RECOVERED_PATH = path.join(__dirname, 'recovered-artwork.json');

/**
 * Artwork hosts, by whether a browser can actually render them. Each host was tested
 * by loading one of its own URLs IN A BROWSER: `curl` without a user agent is refused by
 * some of them while a browser renders the image.
 */
const ARTWORK_HOSTS = Object.freeze({
  /** Verified rendering, with the shape each one serves. */
  renders: Object.freeze([
    'www.coincasino.com', //                          453 rows, 320x407
    'huidu-bucket.s3.ap-southeast-1.amazonaws.com', // 296 rows, 300x200 (landscape)
    'images.rajabet.fun', //                           261 rows, 480x640
    'd3c3rwqla6qxaf.cloudfront.net', //                 15 rows, 427x575
    'static-mobile.mbzp67c522.com', //                   9 rows, 512x728
    'origin-r2.ibbf55-resources.com', //                 1 row,  486x540
    'cdn.softswiss.net', //                            recovered, 427x575 (`s6`)
  ]),

  /**
   * Verified NOT rendering AS GIVEN. `mgasia.canto.global` is an asset-manager album
   * page, `bc.imgix.net` answers 402 Payment Required, `example.com` is a literal
   * placeholder. `boxbet.io` wraps real art: the recovery script unwraps it
   * (`unwrapArtwork`) and keeps the inner URL once it has seen it render.
   */
  dead: Object.freeze([
    'mgasia.canto.global', // 269
    'boxbet.io', //           129 (all recovered, unwrapped)
    'drive.google.com', //     97 (refuses image embeds in every form; 3 files are gone)
    'bc.imgix.net', //          82
    'example.com', //           45
    'rollbit.com', //            2
    'www.luckyblock.com', //     1
  ]),

  /** Renders, but 221x80: a strip, not cover art. */
  unusable: Object.freeze(['s3.ezgif.com', 's7.ezgif.com']),
});

const hostOf = (url) => {
  const match = /^https?:\/\/([^/?#]+)/i.exec(String(url || ''));
  return match ? match[1].toLowerCase() : null;
};

/**
 * The image a wrapper URL stands for, or the URL unchanged.
 *
 *   https://<any>/_next/image?url=<encoded>&w=..   -> the decoded inner URL
 *   https://drive.google.com/open?id=<id>          -> https://drive.google.com/uc?export=view&id=<id>
 *   https://drive.google.com/file/d/<id>/view      -> same
 */
function unwrapArtwork(url) {
  const raw = String(url || '').trim();
  if (!raw) return raw;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return raw;
  }
  if (parsed.pathname === '/_next/image' && parsed.searchParams.get('url')) {
    const inner = parsed.searchParams.get('url');
    return /^https?:\/\//i.test(inner) ? inner : raw;
  }
  if (parsed.hostname.toLowerCase() === 'drive.google.com') {
    const id = parsed.searchParams.get('id') || (/\/file\/d\/([^/]+)/.exec(parsed.pathname) || [])[1];
    if (id && /^[\w-]+$/.test(id)) return `https://drive.google.com/uc?export=view&id=${id}`;
  }
  return raw;
}

/** Can a browser draw this URL as it stands? */
function usableArtwork(url) {
  const host = hostOf(url);
  if (!host) return false;
  if (ARTWORK_HOSTS.dead.includes(host) || ARTWORK_HOSTS.unusable.includes(host)) return false;
  // An unknown host is kept: it has not been shown to fail.
  return true;
}

let recoveredCache = null;
/** `{ game_uid: url }`, the verified recoveries. Empty if the file is missing. */
function recoveredArtwork() {
  if (recoveredCache) return recoveredCache;
  try {
    recoveredCache = Object.freeze(JSON.parse(fs.readFileSync(RECOVERED_PATH, 'utf8')).games || {});
  } catch {
    recoveredCache = Object.freeze({});
  }
  return recoveredCache;
}

/**
 * The artwork a catalogue row should carry, or null.
 *
 * The row's own URL when a browser can draw it, else its verified recovery. An unwrapped
 * URL is NOT used unverified.
 */
function artworkFor({ game_uid: uid, game_icon: icon }, recovered = recoveredArtwork()) {
  const raw = icon ? String(icon).trim() : '';
  if (raw && usableArtwork(raw)) return raw;
  if (uid && Object.hasOwn(recovered, uid)) return recovered[uid];
  return null;
}

module.exports = { ARTWORK_HOSTS, RECOVERED_PATH, hostOf, unwrapArtwork, usableArtwork, recoveredArtwork, artworkFor };
