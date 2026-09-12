'use strict';

/**
 * Generates one Sequelize model per table from the baseline schema dump.
 *
 *   node tools/generate-models.js [--sql path] [--out src/models]
 *
 * Regenerate whenever the baseline changes. Hand edits to generated files are
 * lost — put custom scopes, instance methods and associations in
 * `src/models/associations.js` or in the owning service instead.
 */

const fs = require('fs');
const path = require('path');
const { parseSchema } = require('./parse-schema');
const { domainFor, DOMAIN_OWNER } = require('./domain-map');

// ── Postgres type -> Sequelize DataType ────────────────────────────────
function mapType(column) {
  const type = column.sqlType.toLowerCase().replace(/\s+/g, ' ');

  const varchar = type.match(/^character varying\((\d+)\)$/);
  if (varchar) return `DataTypes.STRING(${varchar[1]})`;
  if (type === 'character varying') return 'DataTypes.STRING';

  const char = type.match(/^character\((\d+)\)$/);
  if (char) return `DataTypes.CHAR(${char[1]})`;

  const numeric = type.match(/^numeric\((\d+),\s*(\d+)\)$/);
  if (numeric) return `DataTypes.DECIMAL(${numeric[1]}, ${numeric[2]})`;
  const numericP = type.match(/^numeric\((\d+)\)$/);
  if (numericP) return `DataTypes.DECIMAL(${numericP[1]}, 0)`;
  if (type === 'numeric' || type === 'decimal') return 'DataTypes.DECIMAL';

  switch (type) {
    case 'text':
      return 'DataTypes.TEXT';
    case 'bigint':
      return 'DataTypes.BIGINT';
    case 'integer':
    case 'int':
    case 'int4':
      return 'DataTypes.INTEGER';
    case 'smallint':
      return 'DataTypes.SMALLINT';
    case 'boolean':
      return 'DataTypes.BOOLEAN';
    case 'json':
      return 'DataTypes.JSON';
    case 'jsonb':
      return 'DataTypes.JSONB';
    case 'uuid':
      return 'DataTypes.UUID';
    case 'date':
      return 'DataTypes.DATEONLY';
    case 'time without time zone':
    case 'time with time zone':
      return 'DataTypes.TIME';
    case 'timestamp with time zone':
    case 'timestamptz':
      return 'DataTypes.DATE';
    case 'timestamp without time zone':
    case 'timestamp':
      // Sequelize's DATE is timestamptz in pg; pin the column type so a
      // migration generated from this model does not silently change it.
      return "'TIMESTAMP'";
    case 'real':
      return 'DataTypes.FLOAT';
    case 'double precision':
      return 'DataTypes.DOUBLE';
    case 'inet':
      return 'DataTypes.INET';
    case 'bytea':
      return 'DataTypes.BLOB';
    case 'interval':
      return "'INTERVAL'";
    default:
      // Unknown/domain types pass through as a raw SQL type string.
      return `'${column.sqlType.toUpperCase()}'`;
  }
}

/** Translate a Postgres DEFAULT expression into a Sequelize defaultValue. */
function mapDefault(column) {
  const raw = column.rawDefault;
  if (raw === null || raw === undefined) return null;
  if (column.autoIncrement) return null; // handled by autoIncrement

  const value = raw.trim();

  if (/^now\(\)$/i.test(value) || /^CURRENT_TIMESTAMP$/i.test(value)) return 'DataTypes.NOW';
  if (/^NULL$/i.test(value)) return null;
  if (/^true$/i.test(value)) return 'true';
  if (/^false$/i.test(value)) return 'false';
  if (/^gen_random_uuid\(\)$/i.test(value) || /^uuid_generate_v4\(\)$/i.test(value)) return 'DataTypes.UUIDV4';

  // '0'::numeric  |  'active'::text  |  'INR'::character varying
  const cast = value.match(/^'([\s\S]*)'::[\w "]+(\[\])?$/);
  if (cast) {
    const literal = cast[1];
    const isJson = /::jsonb?(\[\])?$/i.test(value);
    if (isJson) return `JSON.parse(${JSON.stringify(literal)})`;
    return JSON.stringify(literal.replace(/''/g, "'"));
  }

  // Bare numeric literal
  if (/^-?\d+(\.\d+)?$/.test(value)) return JSON.stringify(value);

  // Bare quoted literal
  const quoted = value.match(/^'([\s\S]*)'$/);
  if (quoted) return JSON.stringify(quoted[1].replace(/''/g, "'"));

  // Any other expression (ARRAY[...], function calls) stays server-side.
  return `sequelize.literal(${JSON.stringify(value)})`;
}

/**
 * Identify created/updated timestamp columns so Sequelize can manage them.
 *
 * MATCHING ON THE NAME ALONE IS NOT ENOUGH. `gisgamesnew.updated_at` is a
 * BIGINT holding the upstream provider's epoch seconds — it is game data that
 * happens to share a name with an ORM convention. Wiring it as the managed
 * `updatedAt` made Sequelize write a Date into a bigint column, so EVERY write
 * through that model failed with
 *
 *     invalid input syntax for type bigint: "2026-08-04 00:48:19 +00:00"
 *
 * and the failure only shows on an insert or update, never on a read — which is
 * why it survived to be found by a test rather than by a boot check.
 *
 * A managed timestamp must therefore be a date/time column as well as a
 * conventionally-named one.
 */
const TIMESTAMP_SQL_TYPES = /^(timestamp|timestamptz|date|datetime)\b/;

function detectTimestamps(columns) {
  const byName = new Map(columns.map((c) => [c.name, c]));
  const isTemporal = (name) =>
    byName.has(name) && TIMESTAMP_SQL_TYPES.test(String(byName.get(name).sqlType).toLowerCase().trim());

  const createdAt = ['created_at', 'createdAt', 'created', 'create_at', 'date_created'].find(isTemporal);
  const updatedAt = ['updated_at', 'updatedAt', 'updated', 'modified_at'].find(isTemporal);
  const deletedAt = ['deleted_at', 'deletedAt'].find(isTemporal);
  return { createdAt: createdAt || null, updatedAt: updatedAt || null, deletedAt: deletedAt || null };
}

const RESERVED = new Set(['sequelize', 'Model', 'DataTypes']);
const isSafeIdentifier = (name) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) && !RESERVED.has(name);
const key = (name) => (isSafeIdentifier(name) ? name : JSON.stringify(name));

/** table_name -> PascalCase model name. */
function toModelName(tableName) {
  if (/^[A-Z]/.test(tableName) && !tableName.includes('_')) return tableName; // already PascalCase (e.g. SportsBet)
  return tableName
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/**
 * 41 legacy tables have no PRIMARY KEY constraint. Sequelize needs a key to
 * identify a row for update/destroy, and it will invent an `id` attribute if we
 * do not give it one — which then blows up against a table that has no such
 * column, or throws outright when an `id` column exists but is unmarked.
 *
 * So we pick a model-level key without touching the database:
 *   1. an existing `id` column,
 *   2. otherwise a single-column UNIQUE constraint,
 *   3. otherwise none — the model drops the phantom `id` and is read-only in
 *      practice (bulk inserts and WHERE-based updates still work).
 */
function resolvePrimaryKey(table) {
  if (table.primaryKey.length) return { columns: table.primaryKey, synthesized: null };

  if (table.columns.some((c) => c.name === 'id')) {
    return { columns: ['id'], synthesized: 'id column (no PRIMARY KEY constraint in the database)' };
  }

  const singleUnique = table.uniques.find((u) => u.columns.length === 1);
  if (singleUnique) {
    return { columns: singleUnique.columns, synthesized: `UNIQUE constraint ${singleUnique.name}` };
  }

  return { columns: [], synthesized: null };
}

function renderModel(table) {
  const modelName = toModelName(table.name);
  const domain = domainFor(table.name);
  const ts = detectTimestamps(table.columns);
  const { columns: primaryKeyColumns, synthesized } = resolvePrimaryKey(table);
  const pk = new Set(primaryKeyColumns);

  // Single-column uniques can live on the attribute; composite ones become indexes.
  const singleUnique = new Map();
  for (const u of table.uniques) {
    if (u.columns.length === 1) singleUnique.set(u.columns[0], u.name);
  }

  const fkByColumn = new Map();
  for (const fk of table.foreignKeys) {
    if (fk.columns.length === 1) fkByColumn.set(fk.columns[0], fk);
  }

  // Columns Sequelize manages itself must not be redeclared as attributes.
  const managed = new Set([ts.createdAt, ts.updatedAt, ts.deletedAt].filter(Boolean));

  const attributeLines = table.columns
    .filter((column) => !managed.has(column.name))
    .map((column) => {
      const lines = [`      type: ${mapType(column)},`];

      if (column.autoIncrement) lines.push('      autoIncrement: true,');
      if (pk.has(column.name)) lines.push('      primaryKey: true,');
      lines.push(`      allowNull: ${column.notNull ? 'false' : 'true'},`);

      const defaultValue = mapDefault(column);
      if (defaultValue !== null) lines.push(`      defaultValue: ${defaultValue},`);

      if (singleUnique.has(column.name)) {
        lines.push(`      unique: ${JSON.stringify(singleUnique.get(column.name))},`);
      }

      const fk = fkByColumn.get(column.name);
      if (fk) {
        lines.push(
          `      references: { model: ${JSON.stringify(fk.referencesTable)}, key: ${JSON.stringify(fk.referencesColumns[0])} },`
        );
        if (fk.onDelete) lines.push(`      onDelete: ${JSON.stringify(fk.onDelete)},`);
        if (fk.onUpdate) lines.push(`      onUpdate: ${JSON.stringify(fk.onUpdate)},`);
      }

      // Attribute name === column name: the legacy schema mixes conventions
      // (uid, refree, two_fa), so renaming would only add a translation layer.
      lines.push(`      field: ${JSON.stringify(column.name)},`);

      return `    ${key(column.name)}: {\n${lines.join('\n')}\n    },`;
    });

  // Only index definitions Sequelize can express go in `indexes`; expression
  // indexes are listed in a comment so nobody "helpfully" recreates them.
  const plainIndexes = [];
  const expressionIndexes = [];
  const columnNames = new Set(table.columns.map((c) => c.name));

  for (const index of [...table.indexes, ...table.uniques.filter((u) => u.columns.length > 1).map((u) => ({ ...u, unique: true, using: 'btree', where: null }))]) {
    const normalized = index.columns.map((c) => c.replace(/^"(.*)"$/, '$1').replace(/\s+(ASC|DESC|NULLS (FIRST|LAST))/gi, '').trim());
    const simple = normalized.every((c) => columnNames.has(c));
    if (simple) {
      plainIndexes.push({ ...index, columns: normalized });
    } else {
      expressionIndexes.push(index);
    }
  }

  const indexLines = plainIndexes.map((index) => {
    const parts = [
      `        name: ${JSON.stringify(index.name)},`,
      `        fields: [${index.columns.map((c) => JSON.stringify(c)).join(', ')}],`,
    ];
    if (index.unique) parts.push('        unique: true,');
    if (index.using && index.using !== 'btree') parts.push(`        using: ${JSON.stringify(index.using.toUpperCase())},`);
    if (index.where) parts.push(`        where: sequelize.literal(${JSON.stringify(index.where)}),`);
    return `      {\n${parts.join('\n')}\n      },`;
  });

  const optionLines = [
    `    sequelize,`,
    `    modelName: ${JSON.stringify(modelName)},`,
    `    tableName: ${JSON.stringify(table.name)},`,
    `    schema: sequelize.options.schema || 'public',`,
    `    freezeTableName: true,`,
    `    underscored: false,`,
  ];

  if (ts.createdAt || ts.updatedAt) {
    optionLines.push('    timestamps: true,');
    optionLines.push(`    createdAt: ${ts.createdAt ? JSON.stringify(ts.createdAt) : 'false'},`);
    optionLines.push(`    updatedAt: ${ts.updatedAt ? JSON.stringify(ts.updatedAt) : 'false'},`);
  } else {
    optionLines.push('    timestamps: false,');
  }

  if (ts.deletedAt) {
    optionLines.push('    paranoid: true,');
    optionLines.push(`    deletedAt: ${JSON.stringify(ts.deletedAt)},`);
  }

  if (indexLines.length) optionLines.push(`    indexes: [\n${indexLines.join('\n')}\n    ],`);

  // No key at all: drop the phantom `id` Sequelize would otherwise add, so the
  // generated SQL matches the real columns.
  const noPrimaryKey = primaryKeyColumns.length === 0;

  const header = [
    `// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.`,
    `// Regenerate with: npm run generate:models --workspace @ibitplay/db`,
    `// Domain: ${domain} (owned by ${DOMAIN_OWNER[domain]})`,
  ];

  const docLines = [];
  if (synthesized) {
    docLines.push('//');
    docLines.push(`// NOTE: this table has no PRIMARY KEY in the database. Sequelize needs a row`);
    docLines.push(`// identity, so the model uses ${synthesized}.`);
    docLines.push(`// Uniqueness is NOT enforced by the database — do not assume it.`);
  }
  if (noPrimaryKey) {
    docLines.push('//');
    docLines.push('// NOTE: no primary key and no unique column. This model supports reads and');
    docLines.push('// inserts; updates/deletes must go through an explicit WHERE clause.');
  }
  if (table.checks.length) {
    docLines.push('//');
    docLines.push('// Database CHECK constraints on this table:');
    for (const check of table.checks) docLines.push(`//   ${check.name}: ${check.expression.replace(/\s+/g, ' ').slice(0, 160)}`);
  }
  if (expressionIndexes.length) {
    docLines.push('//');
    docLines.push('// Expression indexes (created by SQL, not by Sequelize):');
    for (const index of expressionIndexes) {
      docLines.push(`//   ${index.name}${index.unique ? ' UNIQUE' : ''} (${index.columns.join(', ')})`);
    }
  }
  if (table.foreignKeys.length) {
    docLines.push('//');
    docLines.push('// Foreign keys:');
    for (const fk of table.foreignKeys) {
      docLines.push(
        `//   ${fk.columns.join(', ')} -> ${fk.referencesTable}(${fk.referencesColumns.join(', ')})${fk.onDelete ? ` ON DELETE ${fk.onDelete}` : ''}`
      );
    }
  }

  return `'use strict';

${header.join('\n')}${docLines.length ? `\n${docLines.join('\n')}` : ''}

const { Model, DataTypes } = require('sequelize');

class ${modelName} extends Model {}

module.exports = (sequelize) => {
  ${modelName}.init({
${attributeLines.join('\n')}
  }, {
${optionLines.join('\n')}
  });
${noPrimaryKey ? `\n  // This table has no primary key in the schema; drop Sequelize's implicit id\n  // so generated SQL matches the real columns.\n  ${modelName}.removeAttribute('id');\n` : ''}
  return ${modelName};
};
`;
}

// ── CLI ────────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  const arg = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : fallback;
  };

  const root = path.resolve(__dirname, '..');
  const sqlPath = path.resolve(arg('--sql', path.join(root, '000_baseline_schema.sql')));
  const outDir = path.resolve(arg('--out', path.join(root, 'src', 'models')));

  console.log(`Parsing ${sqlPath}`);
  const { tables } = parseSchema(sqlPath);
  console.log(`Found ${tables.length} tables`);

  const byDomain = new Map();

  for (const table of tables) {
    if (!table.columns.length) {
      console.warn(`  ! skipping ${table.name} (no columns parsed)`);
      continue;
    }
    const domain = domainFor(table.name);
    const domainDir = path.join(outDir, domain);
    fs.mkdirSync(domainDir, { recursive: true });

    const modelName = toModelName(table.name);
    fs.writeFileSync(path.join(domainDir, `${modelName}.js`), renderModel(table));

    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain).push({ modelName, tableName: table.name });
  }

  // One barrel per domain, so a service can import exactly the domains it owns.
  for (const [domain, entries] of byDomain) {
    entries.sort((a, b) => a.modelName.localeCompare(b.modelName));
    const body = `'use strict';

// AUTO-GENERATED — do not edit by hand.
// ${domain} domain — owned by ${DOMAIN_OWNER[domain]} (${entries.length} tables).

module.exports = {
${entries.map((e) => `  ${e.modelName}: require('./${e.modelName}'),`).join('\n')}
};
`;
    fs.writeFileSync(path.join(outDir, domain, 'index.js'), body);
    console.log(`  ${domain.padEnd(9)} ${String(entries.length).padStart(3)} models`);
  }

  const summary = Object.fromEntries([...byDomain].map(([d, e]) => [d, e.map((x) => x.modelName)]));
  fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`\nWrote models to ${outDir}`);
}

if (require.main === module) main();

module.exports = { renderModel, toModelName, mapType, mapDefault };
