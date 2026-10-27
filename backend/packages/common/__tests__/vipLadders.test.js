'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { VIP_LADDERS, vipLadderFor, resolveVipLadder, vipLevelFor, VIP_LEVELS, PLATFORM_LADDER } = require('../src');

/**
 * Two ladders, one arithmetic, and the site's `vip` variant picking between them.
 */
test('vip ladders', async (t) => {
  await t.test('every ladder covers every wager without gaps', () => {
    for (const ladder of Object.values(VIP_LADDERS)) {
      const bands = ladder.levels;
      for (let i = 0; i < bands.length - 1; i += 1) {
        assert.equal(Number(bands[i + 1].minXp), Number(bands[i].maxXp) + 1, `${ladder.key}: gap after level ${bands[i].level}`);
        assert.equal(bands[i + 1].level, bands[i].level + 1, `${ladder.key}: levels must be consecutive`);
      }
    }
  });

  await t.test('the platform ladder is the default — hash.game\'s 33 levels', () => {
    assert.equal(vipLadderFor(undefined), PLATFORM_LADDER);
    assert.equal(vipLadderFor('stake'), PLATFORM_LADDER);
    assert.equal(vipLadderFor('none'), PLATFORM_LADDER);
    assert.equal(PLATFORM_LADDER.levels.length, 33);
    assert.deepEqual(PLATFORM_LADDER.levels, VIP_LEVELS);
    // hash.game: Bronze I at 1,000, Bronze IV at 15,000, Silver III at 120,000, Eternal X at 10 bn.
    assert.deepEqual([vipLevelFor('999').level, vipLevelFor('999').name], [0, 'Beginner']);
    assert.deepEqual([vipLevelFor('1000').level, vipLevelFor('1000').name], [1, 'Bronze I']);
    assert.equal(vipLevelFor('15000').name, 'Bronze IV');
    assert.deepEqual([vipLevelFor('120000').level, vipLevelFor('120000').name], [7, 'Silver III']);
    assert.equal(vipLevelFor('10000000000').name, 'Eternal X');
  });

  await t.test("club_ladder is the reference's 75 bands, named VIP 01 … VIP 75", () => {
    const a = vipLadderFor('club_ladder');
    assert.equal(a.key, 'club_ladder');
    assert.equal(a.levels.length, 75);
    assert.equal(a.levels[0].name, 'VIP 01');
    assert.equal(a.top.name, 'VIP 75');
    assert.deepEqual(a.levels.map((b) => b.card).filter((c, i, all) => all.indexOf(c) === i), ['brownz', 'silver', 'gold', 'platinum', 'diamond']);
    // Boundaries as legacy had them.
    assert.equal(a.levelFor('99').level, 1);
    assert.equal(a.levelFor('100').level, 2);
    assert.equal(a.levelFor('120000').name, 'VIP 30');
    assert.equal(a.levelFor('15058625000').level, 75);
  });

  await t.test('the same player ranks differently on each ladder — and neither falls off the ends', () => {
    const a = VIP_LADDERS.addaplay;
    // Below the first band: level 0, distance to the first band, not its floor.
    assert.deepEqual([a.levelFor('0').level, a.levelFor('0').name, a.levelFor('0').wagerToNextLevel], [0, 'VIP 00', '1']);
    assert.equal(PLATFORM_LADDER.levelFor('300').wagerToNextLevel, '700');
    // Above the top: stays at the top, open-ended.
    const whale = a.levelFor('999999999999999');
    assert.deepEqual([whale.level, whale.nextLevel, whale.progressPct], [75, null, '100.00']);
    // The published form hides the top band's ceiling.
    const published = a.publish();
    assert.equal(published.length, 75);
    assert.equal(published[74].maxXp, null);
    assert.equal(published[0].minXp, '1');
  });

  await t.test('each ladder carries its own bonus gates', () => {
    assert.deepEqual(PLATFORM_LADDER.bonusGates, { daily: 1, weekly: 1, monthly: 1 });
    assert.deepEqual(VIP_LADDERS.addaplay.bonusGates, { daily: 20, weekly: 25, monthly: 30 });
    // 1,000 wagered clears the platform daily gate; on addaplay it takes 29,000.
    assert.ok(PLATFORM_LADDER.levelFor('1000').level >= PLATFORM_LADDER.bonusGates.daily);
    assert.ok(VIP_LADDERS.club_ladder.levelFor('1000').level < VIP_LADDERS.club_ladder.bonusGates.daily);
    assert.ok(VIP_LADDERS.club_ladder.levelFor('29000').level >= VIP_LADDERS.club_ladder.bonusGates.daily);
    // `addaplay` is what the variant was called before 048; rows still holding
    // it must land on the same ladder, not on the platform one.
    assert.equal(VIP_LADDERS.addaplay, VIP_LADDERS.club_ladder);
  });

  await t.test("resolveVipLadder reads the site's vip variant, and never throws", async () => {
    const withRow = (variant) => ({ SiteFeature: { findByPk: async (pk) => (pk === 'vip' && variant != null ? { variant } : null) } });
    assert.equal((await resolveVipLadder(withRow('club_ladder'))).key, 'club_ladder');
    // A row written before 048 still selects it.
    assert.equal((await resolveVipLadder(withRow('addaplay'))).key, 'club_ladder');
    // A variant that names no ladder of its own reads the platform one.
    assert.equal((await resolveVipLadder(withRow('club_slider'))).key, 'platform');
    assert.equal((await resolveVipLadder(withRow(null))).key, 'platform');
    // No SiteFeature model on this service: platform.
    assert.equal((await resolveVipLadder({})).key, 'platform');
    assert.equal((await resolveVipLadder(undefined)).key, 'platform');
    // A failing read degrades to the platform ladder and is logged, not thrown.
    const warned = [];
    const broken = { SiteFeature: { findByPk: async () => { throw new Error('db down'); } } };
    assert.equal((await resolveVipLadder(broken, { logger: { warn: (...a) => warned.push(a) } })).key, 'platform');
    assert.equal(warned.length, 1);
  });
});

test('a fractional wager between two integer bands lands in the lower band', () => {
  for (const ladder of Object.values(VIP_LADDERS)) {
    const [a, b] = ladder.levels;
    // a.maxXp = 999, b.minXp = 1000 → 999.5 sits in neither band's [min, max].
    const between = `${Number(a.maxXp)}.5`;
    const r = ladder.levelFor(between);
    assert.equal(r.level, a.level, `${ladder.key}: ${between}`);
    assert.equal(r.nextLevel, b.level);
    assert.equal(Number(r.wagerToNextLevel), 0.5);
    assert.ok(Number(r.progressPct) < 100);
  }
});

test('admin thresholds move the bands; a set that does not climb is ignored', () => {
  const { rebrand } = require('../src/vipLadders');
  const moved = rebrand(PLATFORM_LADDER, { names: new Map([[1, 'Bronze One']]), badges: new Map(), thresholds: new Map([[1, '800']]) });
  assert.deepEqual([moved.levelFor('800').level, moved.levelFor('800').name], [1, 'Bronze One']);
  assert.equal(moved.levels[0].maxXp, 2999);
  const broken = rebrand(PLATFORM_LADDER, { names: new Map(), badges: new Map(), thresholds: new Map([[2, '500']]) });
  assert.equal(broken.levelFor('1000').level, 1, 'a threshold below the level beneath it changes nothing');
});

test('Loyalty Club ladder (bitcasino + smartbet)', async (t) => {
  const { LOYALTY_LADDER, vipLadderFor: pick } = require('../src/vipLadders');
  const { levelUpAmount, rakebackRateForCard } = require('../src/vipRewards');

  await t.test('is what the loyalty_club variant selects', () => {
    assert.equal(pick('loyalty_club'), LOYALTY_LADDER);
  });

  await t.test('ranks points on the bitcasino.io bands', () => {
    const at = (xp) => LOYALTY_LADDER.levelFor(String(xp)).name;
    assert.equal(at(4), 'Beginner');
    assert.equal(at(5), 'Fan');
    assert.equal(at(3749), 'Fan');
    assert.equal(at(3750), 'Expert');
    assert.equal(at(30000), 'Master');
    assert.equal(at(250000), 'Guru');
    assert.equal(at(750000), 'Legend');
    assert.equal(at(3750000), 'Hero');
    assert.equal(at(1e12), 'Hero');
  });

  await t.test('publishes multiplier and milestones, and pays the matching platform tier', () => {
    const hero = LOYALTY_LADDER.publish().at(-1);
    assert.equal(hero.multiplier, '3');
    assert.equal(hero.milestones, 'unlimited');
    assert.equal(rakebackRateForCard('fan'), rakebackRateForCard('bronze'));
    assert.equal(levelUpAmount(6, 'hero'), levelUpAmount(24, 'eternal'));
  });
});
