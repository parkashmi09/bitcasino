import DOMPurify from 'dompurify'

// Admin-written HTML (promotions, blogs) cleaned before it is put into the editor with innerHTML. DOMPurify
// (security step 3.3) replaced the hand-written walker: it also defends against mutation XSS, where markup
// changes meaning when it is serialised and parsed again. Same allow-list as before, kept in step with
// `cleanHtml` in the player site's BlogPostPage.
const ALLOWED_TAGS = [
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'code', 'col', 'colgroup', 'dd', 'del', 'div', 'dl', 'dt', 'em',
  'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'li', 'mark', 'ol', 'p', 'pre',
  'q', 's', 'small', 'span', 'strike', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr',
  'u', 'ul'
]

const ALLOWED_ATTR = [
  'align', 'alt', 'class', 'colspan', 'height', 'href', 'rel', 'rowspan', 'src', 'style', 'target', 'title', 'width'
]

// Removed with everything inside; any other unknown tag is unwrapped (its text kept).
const FORBID_CONTENTS = [
  'applet', 'audio', 'base', 'button', 'embed', 'form', 'frame', 'frameset', 'iframe', 'input', 'link', 'math', 'meta',
  'noembed', 'noframes', 'noscript', 'object', 'option', 'plaintext', 'script', 'select', 'style', 'svg', 'template',
  'textarea', 'title', 'video', 'xmp'
]

const BAD_STYLE = /expression\s*\(|url\s*\(|javascript:|@import|behavior\s*:|-moz-binding/i

let hooked = false

const purifier = () => {
  if (!hooked) {
    DOMPurify.addHook('afterSanitizeAttributes', node => {
      if (node.getAttribute('style') && BAD_STYLE.test(node.getAttribute('style') ?? '')) node.removeAttribute('style')
      if (node.getAttribute('target') === '_blank') node.setAttribute('rel', 'noopener noreferrer')
    })
    hooked = true
  }

  return DOMPurify
}

export function sanitizeHtml(html: string | null | undefined): string {
  if (typeof window === 'undefined') return ''

  return purifier().sanitize(String(html ?? ''), {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_CONTENTS,
    KEEP_CONTENT: true,
    // http, https, mailto, tel and relative links only.
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i
  })
}
