#!/usr/bin/env node
'use strict';
/**
 * One dummy staff login and one dummy player per site, funded and ready to
 * sign in — for a freshly deployed server.
 *
 *   node scripts/make-dummy-accounts.js                    site = SITE_TEMPLATE from .env
 *   node scripts/make-dummy-accounts.js --site roobet
 *   node scripts/make-dummy-accounts.js --site stake --usdt 100 --inr 1000
 *   node scripts/make-dummy-accounts.js --password 'Something@Else1'
 *
 * What it makes, for site `stake`:
 *
 *   staff    stakeadmin  / stakeadmin@stake.local   password Stake@12345   role Admin (level 2)
 *   player   stakeplayer / stakeplayer@stake.local  password Stake@12345   100 USDT + 1000 INR
 *
 * Run it again and it RESETS the password and balances of those two accounts
 * rather than making more — a dummy is a dummy.
 *
 * ── SENIOR STAFF NEED 2FA ────────────────────────────────────────────────
 *
 * Level 3 and above (Admin is level 2) is refused a session until it enrols a
 * second factor. For a dummy login that is in the way: either set
 * `STAFF_2FA_REQUIRED_LEVEL=0` in .env (nobody is forced), or enrol the
 * account with `node scripts/bootstrap-staff-2fa.js --email <staff email>`.
 * This script says which of the two applies when it finishes.
 *
 * ── ON A PRODUCTION DATABASE ─────────────────────────────────────────────
 *
 * These are known passwords. With NODE_ENV=production the script stops unless
 * `--allow-production` is given, so nobody seeds `Stake@12345` onto a live
 * site by muscle memory.
 */
const path = require('path');
const crypto = require('crypto');

const { hashPassword } = require('@ibitplay/auth');
const { connect } = require('@ibitplay/db');
const { loadEnv, coercers, dbEnvShape, createLogger } = require('@ibitplay/common');

const DEFAULTS = { usdt: '100', inr: '1000' };

function parseArgs(argv) {
  const args = { site: null, password: null, usdt: DEFAULTS.usdt, inr: DEFAULTS.inr, allowProduction: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--site') args.site = next();
    else if (a === '--password') args.password = next();
    else if (a === '--usdt') args.usdt = String(next());
    else if (a === '--inr') args.inr = String(next());
    else if (a === '--allow-production') args.allowProduction = true;
    else if (a === '--help' || a === '-h') { console.log(require('fs').readFileSync(__filename, 'utf8').split('*/')[0]); process.exit(0); }
    else { console.error(`unknown argument ${a}`); process.exit(2); }
  }
  return args;
}

/** `stake-site` → `stake`; `hash-games` → `hashgames`. A login name, not a repo name. */
const slug = (site) => String(site).toLowerCase().replace(/-site$/, '').replace(/[^a-z0-9]/g, '');
/** `stake` → `Stake@12345`: 10+ characters, upper, lower, digit, symbol — decent, and easy to remember. */
const easyPassword = (name) => `${name.charAt(0).toUpperCase()}${name.slice(1)}@12345`;

const one = async (sequelize, sql, replacements, transaction) => (await sequelize.query(sql, { replacements, transaction, type: sequelize.QueryTypes.SELECT }))[0] ?? null;
const exec = (sequelize, sql, replacements, transaction) => sequelize.query(sql, { replacements, transaction });

async function allocateUserId(sequelize, transaction) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = crypto.randomInt(1_000_000_000, 9_999_999_999);
    if (!(await one(sequelize, 'SELECT id FROM users WHERE id = :candidate', { candidate }, transaction))) return candidate;
  }
  throw new Error('Could not allocate a free player id after 10 attempts');
}

async function upsertStaff({ sequelize, transaction, name, email, hash, site }) {
  const role = await one(sequelize, 'SELECT id, level FROM roles WHERE level = 2 ORDER BY id LIMIT 1', {}, transaction);
  if (!role) throw new Error('No level-2 (Admin) role — run `npm run db:seed` first');
  const root = await one(sequelize, 'SELECT id FROM staff WHERE parent_id IS NULL ORDER BY id LIMIT 1', {}, transaction);
  if (!root) throw new Error('No root staff account — run `npm run db:seed` first');

  const existing = await one(sequelize, 'SELECT id FROM staff WHERE lower(name) = :name OR lower(email) = :email LIMIT 1', { name, email }, transaction);
  if (existing) {
    await exec(sequelize,
      `UPDATE staff SET password = :hash, password2 = NULL, transaction_password = :hash, first_login = false,
              status = 'active', bet_status = 'active', system_locked = false
        WHERE id = :id`,
      { hash, id: existing.id }, transaction);
    return { id: existing.id, existing: true };
  }

  const [rows] = await exec(sequelize,
    `INSERT INTO staff (name, email, password, transaction_password, role_id, parent_id, percentage, status, first_login, created_at, agent_code)
     VALUES (:name, :email, :hash, :hash, :roleId, :parentId, 0, 'active', false, now(), :code)
     RETURNING id`,
    { name, email, hash, roleId: role.id, parentId: root.id, code: `${site.toUpperCase()}ADM` }, transaction);
  const id = rows[0].id;

  // The closure table: an account missing from it is invisible to every scoped query.
  await exec(sequelize,
    `INSERT INTO staff_hierarchy (ancestor_id, descendant_id, depth)
     SELECT ancestor_id, descendant_id, depth FROM (
       SELECT CAST(:id AS bigint) AS ancestor_id, CAST(:id AS bigint) AS descendant_id, 0 AS depth
       UNION ALL
       SELECT ancestor_id, CAST(:id AS bigint), depth + 1 FROM staff_hierarchy WHERE descendant_id = :parentId
     ) AS rows
     ON CONFLICT (ancestor_id, descendant_id) DO NOTHING`,
    { id, parentId: root.id }, transaction);
  await exec(sequelize,
    `INSERT INTO staff_balances (staff_id, inr, credit_limit, exposure_limit, gt, casino_gt)
     VALUES (:id, 0, 100000, 100000, 0, 0) ON CONFLICT (staff_id) DO NOTHING`,
    { id }, transaction);
  return { id, existing: false };
}

async function upsertPlayer({ sequelize, transaction, name, email, hash, usdt, inr, site }) {
  const existing = await one(sequelize, 'SELECT id FROM users WHERE lower(name) = :name OR lower(email) = :email LIMIT 1', { name, email }, transaction);
  let id = existing?.id;

  if (existing) {
    await exec(sequelize,
      `UPDATE users SET password = :hash, password2 = NULL, status = 'active', bet_status = 'active',
              is_locked = false, system_locked = false, updated_at = now()
        WHERE id = :id`,
      { hash, id }, transaction);
  } else {
    id = await allocateUserId(sequelize, transaction);
    await exec(sequelize,
      `INSERT INTO users
         (id, name, email, password, role_id, status, bet_status, wallet, friends, referalcode, created, updated_at, country, wager_multiplier, exposure_limit)
       VALUES
         (:id, :name, :email, :hash, 6, 'active', 'active', '{}'::json, 'Support,', :referral, now(), now(), 'IN', 3, 100000)`,
      { id, name, email, hash, referral: `${site.toUpperCase()}${String(id).slice(-4)}` }, transaction);
    await exec(sequelize,
      `INSERT INTO userconfig (uid, email_notifications, push_notifications, theme, language, updatedat)
       VALUES (:id, true, true, 'dark', 'en', now()) ON CONFLICT (uid) DO NOTHING`,
      { id }, transaction);
  }

  // `credits` is the balance row; set, not add — a dummy always starts from the same numbers.
  await exec(sequelize,
    `INSERT INTO credits (uid, usdt, inr) VALUES (:id, :usdt, :inr)
     ON CONFLICT (uid) DO UPDATE SET usdt = EXCLUDED.usdt, inr = EXCLUDED.inr`,
    { id, usdt, inr }, transaction);
  return { id, existing: Boolean(existing) };
}

async function main() {
  const args = parseArgs(process.argv);
  const logger = createLogger({ name: 'make-dummy-accounts', pretty: true });
  const config = loadEnv(
    { ...dbEnvShape, NODE_ENV: coercers.str('development'), SITE_TEMPLATE: coercers.optionalStr(), BCRYPT_ROUNDS: coercers.int(12), STAFF_2FA_REQUIRED_LEVEL: coercers.optionalStr() },
    { serviceDir: path.resolve(__dirname, '..') }
  );

  const site = slug(args.site || config.SITE_TEMPLATE || '');
  if (!site) {
    logger.error('Which site? Pass --site <name> or set SITE_TEMPLATE in .env');
    process.exit(2);
  }
  if (config.NODE_ENV === 'production' && !args.allowProduction) {
    logger.error({ database: config.DB_NAME }, 'NODE_ENV=production — these are known passwords. Re-run with --allow-production if you mean it.');
    process.exit(1);
  }

  const password = args.password || easyPassword(site);
  const hash = await hashPassword(password, config.BCRYPT_ROUNDS);
  const staffName = `${site}admin`;
  const playerName = `${site}player`;
  const staffEmail = `${staffName}@${site}.local`;
  const playerEmail = `${playerName}@${site}.local`;

  const db = await connect({ config, logger, domains: ['core', 'admin'] });
  const { sequelize } = db;
  const transaction = await sequelize.transaction();
  let staff;
  let player;
  try {
    staff = await upsertStaff({ sequelize, transaction, name: staffName, email: staffEmail, hash, site });
    player = await upsertPlayer({ sequelize, transaction, name: playerName, email: playerEmail, hash, usdt: args.usdt, inr: args.inr, site });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  } finally {
    await sequelize.close();
  }

  const twoFaLevel = config.STAFF_2FA_REQUIRED_LEVEL === undefined || config.STAFF_2FA_REQUIRED_LEVEL === '' ? 3 : Number(config.STAFF_2FA_REQUIRED_LEVEL);
  const staffNeeds2fa = 2 <= twoFaLevel;

  console.log('');
  console.log(`Dummy accounts for site "${site}" on database ${config.DB_NAME}`);
  console.log('');
  console.log('  role     login (email or name)          password        balance');
  console.log(`  staff    ${staffEmail.padEnd(30)} ${password.padEnd(15)} —              ${staff.existing ? '(existing — password reset)' : '(created)'}`);
  console.log(`  player   ${playerEmail.padEnd(30)} ${password.padEnd(15)} ${args.usdt} USDT + ${args.inr} INR ${player.existing ? '(existing — password and balance reset)' : '(created)'}`);
  console.log('');
  console.log(`  staff name: ${staffName}   player name: ${playerName}   (either signs in with name or email)`);
  if (staffNeeds2fa) {
    console.log('');
    console.log('  ⚠ The staff account is level 2 and will be asked to enrol 2FA before its first session.');
    console.log('    Either set STAFF_2FA_REQUIRED_LEVEL=0 in .env and restart admin-service,');
    console.log(`    or run: node scripts/bootstrap-staff-2fa.js --email ${staffEmail}`);
  }
  console.log('');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
