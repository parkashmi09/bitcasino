'use strict';

/**
 * Carousel, Posters, Auto Update (banner sync) aur Secure Auth Bot ki screens hata di gayi —
 * unki tables bhi. Jin DBs pe purani 104 ne ye tables banayi thi, wahan se hatao.
 * (Ab 104 inhe banati hi nahi.) Idempotent.
 */

const TABLES = ['secure_auth_config', 'banner_sync', 'posters', 'carousels'];

async function up({ sequelize, transaction }) {
  for (const table of TABLES) {
    await sequelize.query(`DROP TABLE IF EXISTS mssports.${table}`, { transaction });
  }
}

// Wapas nahi banate — screens hi nahi hain.
async function down() {}

module.exports = { up, down };
