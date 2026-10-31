/**
 * Staff-written HTML (a blog post body) made safe to hand to
 * `dangerouslySetInnerHTML` — hash-game-exchange's `sanitizeBlogHtml`.
 *
 * An allowlist, parsed with DOMParser (an inert document: nothing runs or
 * loads while it is walked): known formatting tags are kept, script-like
 * ones are dropped with their contents, any other tag is unwrapped to its
 * text, only a few harmless attributes survive, and `href`/`src` must be
 * http(s), mailto, tel or relative (a `data:` image is the one exception).
 * Plain text with no tags becomes paragraphs.
 */
const ALLOWED_TAGS = new Set([
  'a', 'b', 'blockquote', 'br', 'code', 'div', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 's', 'small', 'span', 'strong', 'sub', 'sup', 'table', 'tbody', 'td',
  'tfoot', 'th', 'thead', 'tr', 'u', 'ul',
]);
/* Dropped with everything inside them; any other unknown tag is unwrapped (its text kept). */
const DROP_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'link', 'meta', 'base', 'svg', 'math', 'template', 'noscript', 'frame', 'frameset']);
const ALLOWED_ATTRS = new Set(['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'width', 'height']);
const SAFE_URL = /^(?:https?:|mailto:|tel:|\/|#|\.{0,2}\/)/i;

function safeUrl(value, isImage) {
  // Browsers ignore control characters and whitespace inside a scheme (`java\tscript:`).
  const v = [...String(value ?? '')].filter((ch) => ch.charCodeAt(0) > 32 && ch.charCodeAt(0) !== 127).join('');
  if (!v) return false;
  if (isImage && /^data:image\/(?:png|jpe?g|gif|webp);/i.test(v)) return true;
  return SAFE_URL.test(v) || !/^[a-z][a-z0-9+.-]*:/i.test(v);
}

function clean(node) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 8) {
      child.remove();
      continue;
    }
    if (child.nodeType !== 1) continue;
    const tag = child.tagName.toLowerCase();
    if (DROP_TAGS.has(tag)) {
      child.remove();
      continue;
    }
    clean(child);
    if (!ALLOWED_TAGS.has(tag)) {
      child.replaceWith(...child.childNodes);
      continue;
    }
    for (const attr of [...child.attributes]) {
      const name = attr.name.toLowerCase();
      if (!ALLOWED_ATTRS.has(name) || ((name === 'href' || name === 'src') && !safeUrl(attr.value, name === 'src'))) {
        child.removeAttribute(attr.name);
      }
    }
    if (tag === 'a' && child.getAttribute('href')) {
      child.setAttribute('rel', 'noopener noreferrer nofollow');
      if (/^https?:/i.test(child.getAttribute('href'))) child.setAttribute('target', '_blank');
    }
    if (tag === 'img') child.setAttribute('loading', 'lazy');
  }
}

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Sanitised HTML for operator content. Plain text (no tags) becomes paragraphs. */
export function sanitizeHtml(input) {
  const raw = String(input ?? '');
  if (!raw.trim()) return '';
  const html = /<[a-z][\s\S]*>/i.test(raw)
    ? raw
    : raw
        .split(/\n\s*\n/)
        .map((para) => `<p>${escapeHtml(para.trim()).replace(/\n/g, '<br>')}</p>`)
        .join('');
  if (typeof DOMParser === 'undefined') return escapeHtml(raw);
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  clean(doc.body);
  return doc.body.innerHTML;
}
