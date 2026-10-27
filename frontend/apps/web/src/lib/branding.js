/**
 * The owner panel's branding (`GET /admin/branding/public`): site name, page
 * title, meta, theme colour and the uploaded logo / square mark.
 *
 * Same rules as hash-game-exchange `services/siteBrandingCore.js`: the answer
 * is checked again here, and anything off-limits reads as unset, so an
 * unbranded site keeps this UI's own name, title and SVG logo.
 */
import { SITE_NAME } from './site';

export const BRANDING_STORAGE_KEY = 'bc.branding';

const ASSET_PATH_RE = /^\/api\/v1\/admin\/branding\/asset\/[0-9a-f]{64}\.(png|webp|svg)$/;
const TEXT_LIMITS = { siteName: 40, title: 70, titleTemplate: 80, description: 300, ogTitle: 90, ogDescription: 300 };
/* Angle brackets or a control character: never put in <title> or <meta>. */
const badText = (v) => /[<>]/.test(v) || [...v].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

/** The backend's answer, cleaned; null when the site is not branded. */
export function cleanBranding(data) {
  if (!data || typeof data !== 'object' || !data.branded) return null;
  const out = { branded: true };
  for (const [key, max] of Object.entries(TEXT_LIMITS)) {
    const v = typeof data[key] === 'string' ? data[key].trim() : '';
    out[key] = v && v.length <= max && !badText(v) ? v : null;
  }
  if (!out.siteName) return null;
  if (out.titleTemplate && out.titleTemplate.split('%s').length !== 2) out.titleTemplate = null;
  out.keywords = Array.isArray(data.keywords)
    ? data.keywords.filter((k) => typeof k === 'string' && k && k.length <= 40 && !badText(k)).slice(0, 20)
    : [];
  out.themeColor = typeof data.themeColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(data.themeColor) ? data.themeColor : null;
  for (const key of ['logoUrl', 'markUrl', 'ogImageUrl']) {
    const v = data[key];
    out[key] = typeof v === 'string' && ASSET_PATH_RE.test(v) ? v : null;
  }
  return out;
}

/** The last answer, so a returning visitor sees the owner's logo before the read lands. */
export function readCachedBranding() {
  try {
    return cleanBranding(JSON.parse(localStorage.getItem(BRANDING_STORAGE_KEY) || 'null'));
  } catch {
    return null;
  }
}

export function writeCachedBranding(value) {
  try {
    if (value) localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify(value));
    else localStorage.removeItem(BRANDING_STORAGE_KEY);
  } catch {
    /* private mode: the next load draws the UI's own logo until the read answers */
  }
}

/** The name to print: the owner's, else this build's. */
export const brandName = (branding) => branding?.siteName ?? SITE_NAME;

const COPY_NAME = /Bit[cC]asino/g;

/**
 * Static copy (help articles, terms, related-article lists) was written with this UI's own name;
 * this swaps it for `name`, through arrays and plain objects. Links and asset paths stay as written.
 */
export function withBrand(value, name) {
  if (typeof value === 'string') return /^(https?:|\/)/.test(value) ? value : value.replace(COPY_NAME, name);
  if (Array.isArray(value)) return value.map((v) => withBrand(v, name));
  if (value && Object.getPrototypeOf(value) === Object.prototype && !value.$$typeof) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withBrand(v, name)]));
  }
  return value;
}

function setMeta(attr, key, content) {
  if (!content) return;
  let meta = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute(attr, key);
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', content);
}

/** Puts the branding on the document; leaves index.html's values where nothing is set. */
export function applyBranding(branding) {
  if (!branding || typeof document === 'undefined') return;
  const title = branding.title ?? branding.siteName;
  if (title) document.title = title;
  setMeta('name', 'description', branding.description);
  setMeta('name', 'keywords', branding.keywords.join(', '));
  setMeta('name', 'theme-color', branding.themeColor);
  setMeta('property', 'og:title', branding.ogTitle ?? title);
  setMeta('property', 'og:description', branding.ogDescription ?? branding.description);
  setMeta('property', 'og:image', branding.ogImageUrl && new URL(branding.ogImageUrl, location.origin).href);
  if (branding.markUrl) {
    const type = branding.markUrl.endsWith('.svg') ? 'image/svg+xml' : branding.markUrl.endsWith('.webp') ? 'image/webp' : 'image/png';
    for (const link of document.head.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')) {
      link.setAttribute('href', branding.markUrl);
      if (link.relList.contains('icon')) link.setAttribute('type', type);
    }
  }
}
