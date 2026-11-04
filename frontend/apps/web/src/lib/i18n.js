import { useEffect, useSyncExternalStore } from 'react';
import { useSiteConfig } from '@/queries/siteConfig';

/**
 * The player site's language. Screens are written in English and stay that way: this layer swaps
 * text in the page by exact match against `src/i18n/<code>.json` (keys from
 * `scripts/i18n-strings.mjs`), so anything not in the file (player names, game titles, backend
 * messages, legal prose) stays as it is. React still owns the nodes: a text it rewrites is picked
 * up by the observer and translated again. Add `className="notranslate"` to keep a node out.
 *
 * The owner chooses which languages exist (owner panel `lang_<code>`, `languages` in
 * `GET /admin/site-config/public`). The pick is per browser: the account's `preferences.language`
 * only accepts a different set of codes.
 */
export const LANGUAGES = [
  { code: 'ar', label: 'العربية', dir: 'rtl' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'ja', label: '日本語' },
  { code: 'pt', label: 'Português' },
  { code: 'ru', label: 'Русский' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'zh', label: '中文' },
];
const ENGLISH = 'en';
const KEY = 'bc.language';
const FILES = import.meta.glob('../i18n/*.json');
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
const BRAND = /\bBit[cC]asino\b/g; // this UI's own name in its copy (lib/branding.js COPY_NAME)
const SKIP = 'script,style,textarea,.notranslate';

let current = ENGLISH;
let dictionary = null;
let siteName = null; // the owner's site name; replaces BRAND after translation, so dictionary keys still match
let observer = null;
const listeners = new Set();
const texts = new WeakMap(); // text node → { source, shown }
const attrs = new WeakMap(); // element → { [attribute]: { source, shown } }

const translated = (source) => {
  const key = source.replace(/\s+/g, ' ').trim();
  const hit = key && dictionary && Object.hasOwn(dictionary, key) ? dictionary[key] : null;
  // Keep the node's own leading/trailing whitespace: JSX text often relies on it.
  const out = hit ? source.match(/^\s*/)[0] + hit + source.match(/\s*$/)[0] : source;
  return siteName ? out.replace(BRAND, () => siteName) : out;
};

function doText(node) {
  if (node.parentElement?.closest(SKIP)) return;
  const value = node.nodeValue;
  const seen = texts.get(node);
  const source = seen && seen.shown === value ? seen.source : value;
  const shown = translated(source);
  if (shown !== value) node.nodeValue = shown;
  texts.set(node, { source, shown });
}

function doAttr(el, name) {
  const value = el.getAttribute(name);
  if (value === null || el.closest(SKIP)) return;
  const all = attrs.get(el) ?? {};
  const source = all[name] && all[name].shown === value ? all[name].source : value;
  const shown = translated(source);
  if (shown !== value) el.setAttribute(name, shown);
  all[name] = { source, shown };
  attrs.set(el, all);
}

function doTree(root) {
  if (root.nodeType === Node.TEXT_NODE) return doText(root);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  ATTRS.forEach((name) => doAttr(root, name));
  root.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(',')).forEach((el) => ATTRS.forEach((name) => doAttr(el, name)));
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) doText(walker.currentNode);
}

function observe() {
  observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') doText(r.target);
      else if (r.type === 'attributes') doAttr(r.target, r.attributeName);
      else r.addedNodes.forEach(doTree);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

async function apply(code) {
  current = code;
  const lang = LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[1];
  document.documentElement.lang = lang.code;
  document.documentElement.dir = lang.dir ?? 'ltr';
  listeners.forEach((fn) => fn());
  let next = null;
  try {
    next = code === ENGLISH ? null : ((await FILES[`../i18n/${code}.json`]?.())?.default ?? null);
  } catch {
    /* the file did not load: English, until the next pick */
  }
  if (code !== current) return; // a newer pick won while this one loaded
  dictionary = next;
  refresh();
}

function refresh() {
  const needed = Boolean(dictionary || siteName);
  // Nothing to swap: put every swapped text back.
  if (!needed) restore(document.body);
  else doTree(document.body);
  // Unbranded English has nothing to swap, so it pays for no observer on the live feeds.
  if (needed && !observer) observe();
  if (!needed && observer) {
    observer.disconnect();
    observer = null;
  }
}

/** The owner's site name (null = unbranded, the copy keeps "Bitcasino"); set by the branding effect in useGates. */
export function setSiteName(name) {
  if ((name || null) === siteName || typeof document === 'undefined') return;
  siteName = name || null;
  refresh();
}

function restore(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const seen = texts.get(node);
    if (seen && seen.shown === node.nodeValue && seen.source !== node.nodeValue) node.nodeValue = seen.source;
    texts.delete(node);
  }
  root.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(',')).forEach((el) => {
    const all = attrs.get(el);
    if (!all) return;
    for (const [name, { source, shown }] of Object.entries(all)) if (el.getAttribute(name) === shown) el.setAttribute(name, source);
    attrs.delete(el);
  });
}

function saved() {
  try {
    const code = window.localStorage.getItem(KEY);
    if (LANGUAGES.some((l) => l.code === code)) return code;
  } catch {
    /* storage unavailable */
  }
  return ENGLISH;
}

/** Called once before the first render, so a returning player's choice applies straight away. */
export function startI18n() {
  const code = saved();
  if (code !== ENGLISH) apply(code);
}

export function setLanguage(code) {
  try {
    window.localStorage.setItem(KEY, code);
  } catch {
    /* storage unavailable: it still applies for this visit */
  }
  if (code !== current) apply(code);
}

const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** The language on screen now (a code). */
export function useLanguage() {
  return useSyncExternalStore(subscribe, () => current, () => current);
}

/** The owner's `languages`, or null until the site config answers. */
function useSiteLanguages() {
  const { config, isPending } = useSiteConfig();
  return isPending ? null : config.raw.languages;
}

const allowedOf = (codes) => (Array.isArray(codes) ? LANGUAGES.filter((l) => codes.includes(l.code)) : []);

/** The languages a picker may show: none until the site config has answered. */
export function useAllowedLanguages() {
  return allowedOf(useSiteLanguages());
}

/**
 * Moves the page off a language the owner switched off (to English, else the first allowed).
 * The saved choice is kept, so switching it back on returns the player to it.
 */
export function useLanguageGuard() {
  const codes = useSiteLanguages();
  useEffect(() => {
    if (!Array.isArray(codes)) return;
    const allowed = allowedOf(codes);
    const want = saved();
    const fallback = allowed.length === 0 || allowed.some((l) => l.code === ENGLISH) ? ENGLISH : allowed[0].code;
    const target = allowed.some((l) => l.code === want) ? want : fallback;
    if (target !== current) apply(target);
  }, [codes]);
}

/** The current language's own name, and whether a picker shows at all (two or more allowed). */
export function useLanguageLabel() {
  const allowed = useAllowedLanguages();
  const lang = useLanguage();
  return { label: allowed.find((l) => l.code === lang)?.label ?? 'English', show: allowed.length >= 2 };
}
