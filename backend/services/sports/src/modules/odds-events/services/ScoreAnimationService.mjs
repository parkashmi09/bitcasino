// services/ScoreAnimationService.js — mssports core, moved unchanged

import dotenv4 from "dotenv";
import axios2 from "axios";
dotenv4.config();
var HOST_URL = process.env.SCORECARD_HOST_URL || "https://scorecard.daimond-api.site/";
// The host whitelists by Referer: without one (a bare server request) it answers "Domain Not
// Whitelisted" and no provider url — which is why every score-url answered 502 and the page fell
// back to the host's 404 image (BC games sports issues #12). parker567.com is whitelisted.
var HOST_HEADERS = { Referer: process.env.SCORECARD_REFERER || "https://parker567.com/" };
var MAX_ATTEMPTS = 5;
var TIMEOUT_MS = 8e3;
var PROVIDER_RE = /https?:\/\/[a-z0-9.-]*animationprovider\.com\/[^"'\s]+/i;
var isNotFoundPage = (html) => !html || html.length < 4e3 || /<title>\s*Page Not Found/i.test(html);
async function fetchOnce(etid, gmid) {
  const hostUrl = `${HOST_URL.replace(/\/+$/, "")}/?etid=${encodeURIComponent(etid)}&gmid=${encodeURIComponent(gmid)}`;
  const host = await axios2.get(hostUrl, { timeout: TIMEOUT_MS, responseType: "text", headers: HOST_HEADERS });
  const match = PROVIDER_RE.exec(String(host.data || ""));
  if (!match) return { ok: false, reason: "no provider url in host page" };
  const providerUrl = match[0];
  const page = await axios2.get(providerUrl, {
    timeout: TIMEOUT_MS,
    responseType: "text",
    // The provider answers 200 for its 404 page; never let axios throw on
    // status, the body is the only signal that matters.
    validateStatus: () => true
  });
  const html = String(page.data || "");
  if (isNotFoundPage(html)) return { ok: false, reason: "dead token", providerUrl };
  return { ok: true, html, providerUrl };
}
function withBase(html, providerUrl) {
  const origin = new URL(providerUrl).origin;
  const tag = `<base href="${origin}/">`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head([^>]*)>/i, `<head$1>${tag}`) : `${tag}${html}`;
}
async function getScoreUrl(etid, gmid) {
  const hostUrl = `${HOST_URL.replace(/\/+$/, "")}/?etid=${encodeURIComponent(etid)}&gmid=${encodeURIComponent(gmid)}`;
  const host = await axios2.get(hostUrl, { timeout: TIMEOUT_MS, responseType: "text", headers: HOST_HEADERS });
  const match = PROVIDER_RE.exec(String(host.data || ""));
  return match ? match[0] : null;
}
async function getScoreAnimation(etid, gmid) {
  let lastReason = "unknown";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await fetchOnce(etid, gmid);
      if (result.ok) {
        return { ok: true, html: withBase(result.html, result.providerUrl), attempts: attempt };
      }
      lastReason = result.reason;
    } catch (error) {
      lastReason = error.message;
    }
  }
  return { ok: false, attempts: MAX_ATTEMPTS, reason: lastReason };
}
// Cricket scoreboard embed: a 200 page means the provider has the match, a 404 that it has not.
// The browser cannot read the status (no CORS), so the check is done here and cached per gmid.
// Empty CRICKET_SCORE_EMBED_URL switches it off (cricket then gets null → the socket card).
var EMBED_URL = process.env.CRICKET_SCORE_EMBED_URL ?? "https://dzfytm4o128av.cloudfront.net/embed/{gmid}?theme=dark";
var EMBED_TIMEOUT_MS = 4e3;
var EMBED_TTL_MS = 3 * 60e3;
var embedCache = /* @__PURE__ */ new Map();
async function getCricketEmbedUrl(gmid, { template = EMBED_URL, get = axios2.get, now = Date.now } = {}) {
  if (!template) return null;
  const hit = embedCache.get(String(gmid));
  if (hit && hit.until > now()) return hit.url;
  const url = template.replace("{gmid}", encodeURIComponent(gmid));
  let ok = false;
  try {
    const res = await get(url, { timeout: EMBED_TIMEOUT_MS, responseType: "text", validateStatus: () => true });
    ok = res.status === 200;
  } catch {
    ok = false;
  }
  // shortcut: unbounded Map, one entry per cricket gmid ever asked; prune if it ever grows large.
  embedCache.set(String(gmid), { url: ok ? url : null, until: now() + EMBED_TTL_MS });
  return ok ? url : null;
}
var ScoreAnimationService_default = { getScoreAnimation, getScoreUrl, getCricketEmbedUrl, _embedCache: embedCache };

export { ScoreAnimationService_default };
