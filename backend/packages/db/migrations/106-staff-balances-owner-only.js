'use strict';

/**
 * `staff_balances` ab sirf Super Admin (owner, role level 1) ka Direct Users balance hai.
 * Baaki staff (admin, master, agent, executive…) ka balance migration 099 se `credits` me
 * chala gaya — unki `staff_balances` rows sirf purani copy thi, isliye hatao.
 * Idempotent.
 */
async function up({ sequelize, transaction }) {
  await sequelize.query(
    `DELETE FROM staff_balances sb
      WHERE NOT EXISTS (
        SELECT 1 FROM staff s JOIN roles r ON r.id = s.role_id
         WHERE s.id = sb.staff_id AND r.level = 1
      )`,
    { transaction }
  );
}

// Wapas nahi banate — wo balance `credits` me hai.
async function down() {}

module.exports = { up, down };
