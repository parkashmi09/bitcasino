'use strict';

/**
 * Filling a push template: `{amount}` is the figure with its currency, every
 * other `{key}` is `meta[key]`. An unknown placeholder renders empty, and the
 * whitespace it leaves is tidied, so "Reason: {reason}." with no reason does
 * not leave a placeholder on a lock screen.
 */

/** "500" + "INR" → "500.00 INR"; small crypto keeps up to 8 dp, trimmed. Same as user-service's notifyPlayer. */
function amountText(amount, currency) {
  if (amount == null || amount === '') return '';
  const n = Number.parseFloat(String(amount));
  if (!Number.isFinite(n)) return `${amount} ${currency ?? ''}`.trim();
  const code = String(currency ?? '').toUpperCase();
  const fixed = n.toFixed(Math.abs(n) >= 1 ? 2 : 8).replace(/(\.\d{2}\d*?)0+$/, '$1');
  return code ? `${fixed} ${code}` : fixed;
}

function render(template, meta = {}) {
  if (template == null) return null;
  const m = meta && typeof meta === 'object' ? meta : {};
  const out = String(template).replace(/\{([a-zA-Z][a-zA-Z0-9_]{0,39})\}/g, (_, key) => {
    if (key === 'amount') return amountText(m.amount, m.currency);
    if (key === 'currency') return m.currency == null ? '' : String(m.currency).toUpperCase();
    const v = m[key];
    return v == null ? '' : String(v);
  });
  return out.replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,!?])/g, '$1').trim();
}

/** The placeholders a template uses — shown in the admin editor. */
function placeholdersIn(template) {
  return [...new Set([...String(template ?? '').matchAll(/\{([a-zA-Z][a-zA-Z0-9_]{0,39})\}/g)].map((m) => m[1]))];
}

module.exports = { render, amountText, placeholdersIn };
