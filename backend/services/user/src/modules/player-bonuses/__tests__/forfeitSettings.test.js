'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { PlayerBonusService } = require('../playerBonus.service');

/**
 * The site admin's bonus settings (Limits and policy → Bonus), without a database: the forfeit
 * switch decides between 409 BONUS_FORFEIT_REQUIRED (with the popup copy) and 403
 * BONUS_WAGER_REQUIRED, and the lock is on only while the owner's switch and the admin's are both on.
 */

const ACTIVE = [{ id: 7, amount: '500', currency: 'INR', required_wager: '5000', wagered: '2000', status: 'active', unlock_mode: 'rollover' }];

function service(settings, { owner = true, active = ACTIVE } = {}) {
  const svc = new PlayerBonusService({
    models: { PlayerBonus: { findAll: async () => active } },
    logger: null,
    walletService: {},
    rewardMoney: {},
    bonusWageringLock: async () => owner,
    operatorSettings: { read: async (key, fallback) => (key in settings ? settings[key] : fallback) },
  });
  svc.expireDue = async () => {};
  return svc;
}

const refused = (svc, opts) => svc.beforeWithdrawal(1, opts).then(() => null, (error) => error);

test('forfeit allowed (default): 409 with the admin copy, a confirmed resend passes the check', async () => {
  const svc = service({ bonus_forfeit_title: 'Bonus jayega', bonus_forfeit_message: 'Pakka?' });
  const error = await refused(svc, {});
  assert.equal(error.code, 'BONUS_FORFEIT_REQUIRED');
  assert.equal(error.details.title, 'Bonus jayega');
  assert.equal(error.details.message, 'Pakka?');
  assert.equal(Number(error.details.bonuses[0].amount), 500);
  assert.deepEqual(await svc.beforeWithdrawal(1, { forfeitBonus: true }), { forfeited: [], pending: 1 });
});

test('forfeit off: 403 BONUS_WAGER_REQUIRED, even when the player sends forfeitBonus', async () => {
  const svc = service({ bonus_forfeit_allowed: 'false' });
  assert.equal((await refused(svc, {})).code, 'BONUS_WAGER_REQUIRED');
  assert.equal((await refused(svc, { forfeitBonus: true })).code, 'BONUS_WAGER_REQUIRED');
});

test('no active bonus: nothing to confirm, whatever the switch', async () => {
  const svc = service({ bonus_forfeit_allowed: false }, { active: [] });
  assert.deepEqual(await svc.beforeWithdrawal(1, {}), { forfeited: [] });
});

test('wagering lock: owner AND site admin must both be on', async () => {
  assert.equal(await service({}).lockOn(), true);
  assert.equal(await service({ bonus_wagering_lock: 'false' }).lockOn(), false);
  assert.equal(await service({ bonus_wagering_lock: true }, { owner: false }).lockOn(), false);
});
