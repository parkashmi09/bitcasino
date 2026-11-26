import DOMPurify from 'dompurify';

/**
 * Staff-written HTML from the API (blog post bodies, promotion descriptions
 * and terms) made safe to hand to `dangerouslySetInnerHTML`. Every such render
 * goes through here.
 *
 * DOMPurify's HTML profile, minus anything that can restyle or capture input:
 * no `style`, forms or form controls, and no `class`/`id` (the page's own
 * utility classes would let content overlay the site). Script-like tags are
 * dropped with their contents, unknown tags are unwrapped to their text, and
 * URLs must be http(s), mailto, tel or relative (a `data:` image is allowed).
 * Links open in a new tab with `rel="noopener noreferrer nofollow"`, images
 * load lazily. Plain text with no tags becomes paragraphs.
 */
const CONFIG = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select'],
  FORBID_ATTR: ['style', 'class', 'id'],
};

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  const tag = node.tagName?.toLowerCase();
  if (tag === 'a' && node.getAttribute('href')) {
    node.setAttribute('rel', 'noopener noreferrer nofollow');
    if (/^https?:/i.test(node.getAttribute('href'))) node.setAttribute('target', '_blank');
  }
  if (tag === 'img') node.setAttribute('loading', 'lazy');
});

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
  // No DOM (server-side render): DOMPurify would hand the input back unsanitised.
  if (!DOMPurify.isSupported) return escapeHtml(raw);
  return DOMPurify.sanitize(html, CONFIG);
}
