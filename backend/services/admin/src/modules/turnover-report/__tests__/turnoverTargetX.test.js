'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { v } = require('../routes/admin.routes');

test('TargetX must be above 0 and at most 100', () => {
  for (const body of [v.setAll.body, v.setUser.body]) {
    assert.equal(body.safeParse({ multiplier: 0 }).success, false);
    assert.equal(body.safeParse({ multiplier: 0.01 }).success, true);
    assert.equal(body.safeParse({ multiplier: 100 }).success, true);
    assert.equal(body.safeParse({ multiplier: 100.01 }).success, false);
  }
});
