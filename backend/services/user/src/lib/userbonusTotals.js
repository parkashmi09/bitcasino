'use strict';

const { money } = require('@ibitplay/common');

/** Columns this helper may add to — they land in an identifier position. */
const ALLOWED = new Set([
  'totalbonus', 'vipbonus', 'rakebonus', 'specialbonus', 'generalbonus',
  'actualdailybonus', 'actualweeklybonus', 'actualmonthlybonus',
]);

/**
 * Add paid amounts to a player's `userbonus` running totals — the figures the
 * admin Bonus screen reads — creating the row on first use.
 *
 * `UPDATE … WHERE userid = $1` against a row that does not exist yet matches
 * nothing and reports success, so a player's first claim moved no total.
 * `totalbonus`, `vipbonus`, `specialbonus`, `generalbonus` and `name` are
 * NOT NULL with no database default, so the create names all of them.
 *
 * Additions are done by the database (`COALESCE(col, 0) + n`) so two credits
 * landing together both count.
 */
async function addToUserbonus({ models, db }, userId, amounts, { transaction, set = {} } = {}) {
  const user = await models.Users.findByPk(userId, { attributes: ['name'], raw: true, transaction });
  await models.Userbonus.findOrCreate({
    where: { userid: userId },
    defaults: {
      userid: userId,
      name: user?.name ?? String(userId),
      totalbonus: '0',
      vipbonus: '0',
      specialbonus: '0',
      generalbonus: '0',
      createdat: new Date(),
      updatedat: new Date(),
    },
    transaction,
  });

  const patch = { ...set, updatedat: new Date() };
  for (const [column, amount] of Object.entries(amounts)) {
    if (!ALLOWED.has(column)) throw new Error(`userbonus column not allowed: ${column}`);
    const value = money.toDecimalString(money.toMinor(String(amount)));
    patch[column] = db.sequelize.literal(`COALESCE("${column}", 0) + ${value}`);
  }

  await models.Userbonus.update(patch, { where: { userid: userId }, transaction });
}

module.exports = { addToUserbonus };
