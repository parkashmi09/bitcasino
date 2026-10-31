'use strict';

const { KEYS } = require('./siteContent.validators');

/** `site_content` reads and writes (migration 179). Values are validated by the route before `set`. */
function siteContentService({ db }) {
  const query = (sql, replacements = {}) => db.sequelize.query(sql, { replacements, type: db.sequelize.QueryTypes.SELECT });

  return {
    /** `{ key: value }` for every known section that has been saved. */
    async all() {
      const rows = await query('SELECT key, value FROM site_content WHERE key IN (:keys)', { keys: KEYS });
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    },

    async set(key, value, staffId) {
      const [row] = await query(
        `INSERT INTO site_content (key, value, updated_by) VALUES (:key, CAST(:value AS JSONB), :staffId)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
         RETURNING value`,
        { key, value: JSON.stringify(value), staffId: Number.isInteger(staffId) ? staffId : null }
      );
      return row.value;
    },
  };
}

module.exports = { siteContentService };
