'use strict';

/**
 * A small pg_dump DDL reader.
 *
 * It understands the subset of `pg_dump --schema-only` output that matters for
 * generating models: sequences, tables, columns (type/default/nullability),
 * primary keys, unique + foreign-key constraints, and indexes. Views and
 * functions are recognised and skipped.
 *
 * Parsing the dump instead of hand-writing 127 models means the column types,
 * defaults and constraints in the models are the ones actually in the database
 * — not the ones someone remembered while typing.
 */

const fs = require('fs');

/** Strip `public.` and surrounding double quotes from an identifier. */
function cleanIdent(raw) {
  return String(raw)
    .trim()
    .replace(/^public\./i, '')
    .replace(/^"(.*)"$/, '$1');
}

/** Split a comma-separated column list, honouring quotes and nested parens. */
function splitTopLevel(input, separator = ',') {
  const parts = [];
  let depth = 0;
  let inString = false;
  let inQuote = false;
  let current = '';

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === "'" && !inQuote) inString = !inString;
    else if (ch === '"' && !inString) inQuote = !inQuote;
    else if (!inString && !inQuote) {
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      else if (ch === separator && depth === 0) {
        parts.push(current.trim());
        current = '';
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

const COLUMN_LIST = (raw) => splitTopLevel(raw).map(cleanIdent);

function parseSchema(sqlPath) {
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const tables = new Map();
  const sequences = new Set();

  const table = (name) => {
    if (!tables.has(name)) {
      tables.set(name, {
        name,
        columns: [],
        primaryKey: [],
        uniques: [],
        foreignKeys: [],
        checks: [],
        indexes: [],
      });
    }
    return tables.get(name);
  };

  // ── Sequences ────────────────────────────────────────────────────────
  for (const match of sql.matchAll(/CREATE SEQUENCE\s+(public\.[^\s;]+)/gi)) {
    sequences.add(cleanIdent(match[1]));
  }

  // ── CREATE TABLE blocks ──────────────────────────────────────────────
  const tableRe = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(public\.(?:"[^"]+"|[A-Za-z0-9_]+))\s*\(([\s\S]*?)\n\);/gi;
  for (const match of sql.matchAll(tableRe)) {
    const tableName = cleanIdent(match[1]);
    const body = match[2];
    const entry = table(tableName);

    for (const line of splitTopLevel(body)) {
      const trimmed = line.trim().replace(/\s+/g, ' ');
      if (!trimmed) continue;

      // Table-level constraints declared inline.
      const checkMatch = trimmed.match(/^CONSTRAINT\s+("?[\w.]+"?)\s+CHECK\s*\(([\s\S]+)\)$/i);
      if (checkMatch) {
        entry.checks.push({ name: cleanIdent(checkMatch[1]), expression: checkMatch[2] });
        continue;
      }
      if (/^(CONSTRAINT|PRIMARY KEY|UNIQUE|FOREIGN KEY|CHECK|EXCLUDE)\b/i.test(trimmed)) {
        const pk = trimmed.match(/PRIMARY KEY\s*\(([^)]+)\)/i);
        if (pk) entry.primaryKey = COLUMN_LIST(pk[1]);
        continue;
      }

      const column = parseColumn(trimmed);
      if (column) entry.columns.push(column);
    }
  }

  // ── Serial columns declared via a separate ALTER ... SET DEFAULT ─────
  const alterDefaultRe =
    /ALTER TABLE ONLY\s+(public\.(?:"[^"]+"|[\w]+))\s+ALTER COLUMN\s+("?\w+"?)\s+SET DEFAULT\s+([^;]+);/gi;
  for (const match of sql.matchAll(alterDefaultRe)) {
    const entry = tables.get(cleanIdent(match[1]));
    if (!entry) continue;
    const columnName = cleanIdent(match[2]);
    const column = entry.columns.find((c) => c.name === columnName);
    if (!column) continue;
    column.rawDefault = match[3].trim();
    if (/nextval\(/i.test(column.rawDefault)) column.autoIncrement = true;
  }

  // ── Table constraints added after the fact ───────────────────────────
  const constraintRe =
    /ALTER TABLE ONLY\s+(public\.(?:"[^"]+"|[\w]+))\s*\n?\s*ADD CONSTRAINT\s+("?[\w.]+"?)\s+([\s\S]*?);(?=\n)/gi;
  for (const match of sql.matchAll(constraintRe)) {
    const entry = tables.get(cleanIdent(match[1]));
    if (!entry) continue;
    const constraintName = cleanIdent(match[2]);
    const definition = match[3].replace(/\s+/g, ' ').trim();

    const pk = definition.match(/^PRIMARY KEY\s*\(([^)]+)\)/i);
    if (pk) {
      entry.primaryKey = COLUMN_LIST(pk[1]);
      continue;
    }

    const unique = definition.match(/^UNIQUE\s*\(([^)]+)\)/i);
    if (unique) {
      entry.uniques.push({ name: constraintName, columns: COLUMN_LIST(unique[1]) });
      continue;
    }

    const fk = definition.match(
      /^FOREIGN KEY\s*\(([^)]+)\)\s*REFERENCES\s+(public\.(?:"[^"]+"|[\w]+))\s*\(([^)]+)\)(.*)$/i
    );
    if (fk) {
      const tail = fk[4] || '';
      entry.foreignKeys.push({
        name: constraintName,
        columns: COLUMN_LIST(fk[1]),
        referencesTable: cleanIdent(fk[2]),
        referencesColumns: COLUMN_LIST(fk[3]),
        onDelete: (tail.match(/ON DELETE\s+([A-Z ]+?)(?:\s+ON|\s*$)/i) || [])[1]?.trim() || null,
        onUpdate: (tail.match(/ON UPDATE\s+([A-Z ]+?)(?:\s+ON|\s*$)/i) || [])[1]?.trim() || null,
      });
      continue;
    }

    const check = definition.match(/^CHECK\s*\(([\s\S]+)\)$/i);
    if (check) entry.checks.push({ name: constraintName, expression: check[1] });
  }

  // ── Indexes ──────────────────────────────────────────────────────────
  const indexRe =
    /CREATE(\s+UNIQUE)?\s+INDEX(?:\s+IF NOT EXISTS)?\s+("?[\w.]+"?)\s+ON\s+(public\.(?:"[^"]+"|[\w]+))\s+(?:USING\s+(\w+)\s+)?\(([^;]*?)\)(\s+WHERE\s+[^;]+)?;/gi;
  for (const match of sql.matchAll(indexRe)) {
    const entry = tables.get(cleanIdent(match[3]));
    if (!entry) continue;
    entry.indexes.push({
      name: cleanIdent(match[2]),
      unique: Boolean(match[1]),
      using: match[4] || 'btree',
      // Index expressions (lower(x), jsonb ops) are kept raw — they are
      // documented on the model but created by SQL, not by Sequelize sync.
      columns: splitTopLevel(match[5]).map((c) => c.trim()),
      where: match[6] ? match[6].replace(/^\s*WHERE\s+/i, '').trim() : null,
    });
  }

  return { tables: [...tables.values()].sort((a, b) => a.name.localeCompare(b.name)), sequences: [...sequences] };
}

/** Parse one column definition line: `name type [DEFAULT x] [NOT NULL]`. */
function parseColumn(line) {
  const match = line.match(/^("?[\w]+"?)\s+([\s\S]+)$/);
  if (!match) return null;

  const name = cleanIdent(match[1]);
  let rest = match[2].trim();

  const notNull = /\bNOT NULL\b/i.test(rest);
  rest = rest.replace(/\s*\bNOT NULL\b/gi, '').trim();

  let rawDefault = null;
  const defaultMatch = rest.match(/\bDEFAULT\s+([\s\S]+)$/i);
  if (defaultMatch) {
    rawDefault = defaultMatch[1].trim();
    rest = rest.slice(0, defaultMatch.index).trim();
  }

  // Generated / identity columns behave like serials for our purposes.
  const isIdentity = /GENERATED\s+(ALWAYS|BY DEFAULT)\s+AS\s+IDENTITY/i.test(rest);
  rest = rest.replace(/GENERATED\s+(ALWAYS|BY DEFAULT)\s+AS\s+IDENTITY[\s\S]*$/i, '').trim();

  const isArray = /\[\]\s*$/.test(rest);
  const baseType = rest.replace(/\[\]\s*$/, '').trim();

  return {
    name,
    sqlType: baseType,
    isArray,
    notNull,
    rawDefault,
    autoIncrement: isIdentity || Boolean(rawDefault && /nextval\(/i.test(rawDefault)),
  };
}

module.exports = { parseSchema, cleanIdent, splitTopLevel };
