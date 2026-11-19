// Admin-written HTML (promotions, blogs) cleaned with the browser's own parser and an allow-list, before it
// is put into the editor with innerHTML. Kept in step with `cleanHtml` in the player site's BlogPostPage.
const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'code', 'col', 'colgroup', 'dd', 'del', 'div', 'dl', 'dt', 'em',
  'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'li', 'mark', 'ol', 'p', 'pre',
  'q', 's', 'small', 'span', 'strike', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr',
  'u', 'ul'
])

// Removed with everything inside; any other unknown tag is unwrapped (its text kept).
const DROPPED_TAGS = new Set([
  'applet', 'audio', 'base', 'button', 'embed', 'form', 'frame', 'frameset', 'iframe', 'input', 'link', 'math', 'meta',
  'noembed', 'noframes', 'noscript', 'object', 'option', 'plaintext', 'script', 'select', 'style', 'svg', 'template',
  'textarea', 'title', 'video', 'xmp'
])

const ALLOWED_ATTRS = new Set([
  'align', 'alt', 'class', 'colspan', 'height', 'href', 'rel', 'rowspan', 'src', 'style', 'target', 'title', 'width'
])

// Browsers ignore tab/newline/control chars inside a URL scheme (`java\tscript:`), so strip them before checking.
const safeUrl = (value: string) => {
  const flat = value.replace(/[\u0000-\u0020\u007f-\u009f]/g, '')
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(flat)

  return !scheme || ['http', 'https', 'mailto', 'tel'].includes(scheme[1].toLowerCase())
}

const cleanNode = (parent: Node) => {
  for (const node of [...parent.childNodes]) {
    if (node.nodeType === Node.TEXT_NODE) continue

    if (node.nodeType !== Node.ELEMENT_NODE) {
      node.remove()
      continue
    }

    const el = node as Element
    const tag = el.localName

    if (el.namespaceURI !== 'http://www.w3.org/1999/xhtml' || DROPPED_TAGS.has(tag)) {
      el.remove()
      continue
    }

    cleanNode(el)

    if (!ALLOWED_TAGS.has(tag)) {
      el.replaceWith(...el.childNodes)
      continue
    }

    for (const { name, value } of [...el.attributes]) {
      const bad =
        !ALLOWED_ATTRS.has(name) ||
        ((name === 'href' || name === 'src') && !safeUrl(value)) ||
        (name === 'style' && /expression\s*\(|url\s*\(|javascript:|@import|behavior\s*:|-moz-binding/i.test(value))

      if (bad) el.removeAttribute(name)
    }

    if (el.getAttribute('target') === '_blank') el.setAttribute('rel', 'noopener noreferrer')
  }
}

export function sanitizeHtml(html: string | null | undefined): string {
  const doc = new DOMParser().parseFromString(String(html ?? ''), 'text/html')

  cleanNode(doc.body)

  return doc.body.innerHTML
}
