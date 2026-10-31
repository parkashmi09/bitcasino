'use strict';

/**
 * A small RFC 4180 reader, for the catalogue dumps under this folder.
 *
 * `split(',')` is wrong on this data and not marginally so: game names carry
 * commas ("Book of Ra, Deluxe"), artwork URLs carry them in query strings, and
 * a handful of rows carry an embedded newline. The parser below walks the text
 * one character at a time and is the only thing that reads these files.
 *
 * Two conventions come from the pg_dump-style export rather than from the RFC,
 * so they are handled here rather than at every call site:
 *
 *   NULL        an UNQUOTED `NULL` is the absent value. `"NULL"` quoted is the
 *               four-character string, and stays one.
 *   True/False  Postgres booleans, exported capitalised.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  /** Distinguishes an empty unquoted field (NULL-able) from `""` (a string). */
  let wasQuoted = false;

  // A BOM would otherwise become part of the first header name.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const endField = () => {
    row.push(wasQuoted ? field : coerce(field));
    field = '';
    wasQuoted = false;
  };
  const endRow = () => {
    endField();
    // A trailing newline must not produce a final row of one empty field.
    if (row.length > 1 || row[0] !== null) rows.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];

    if (quoted) {
      if (ch !== '"') { field += ch; continue; }
      // `""` inside a quoted field is one literal quote.
      if (src[i + 1] === '"') { field += '"'; i += 1; continue; }
      quoted = false;
      continue;
    }

    if (ch === '"') { quoted = true; wasQuoted = true; continue; }
    if (ch === ',') { endField(); continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { endRow(); continue; }
    field += ch;
  }

  // No trailing newline — the last row is still a row.
  if (field !== '' || row.length) endRow();

  return rows;
}

/** Unquoted scalars: the dump's `NULL`, `True` and `False`, everything else raw. */
function coerce(raw) {
  const v = raw.trim();
  if (v === '' || v === 'NULL') return null;
  if (v === 'True') return true;
  if (v === 'False') return false;
  return v;
}

/** `parseCsv`, with the first row taken as the header. */
function parseCsvObjects(text) {
  const [header, ...rest] = parseCsv(text);
  if (!header) return [];
  return rest.map((cells) => {
    const out = {};
    header.forEach((key, i) => { out[String(key)] = cells[i] ?? null; });
    return out;
  });
}

module.exports = { parseCsv, parseCsvObjects };
