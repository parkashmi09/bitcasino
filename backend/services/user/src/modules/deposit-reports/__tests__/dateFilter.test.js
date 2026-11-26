'use strict';

const test = require('node:test');
const assert = require('node:assert');
const v = require('../depositReports.validators');

// Free text in a date filter reached the SQL and answered 500 (ZAP scan, 2026-11-26).
test('report date filters take real dates only', () => {
  const ok = v.fiatStats.query.safeParse({ startDate: '2026-11-01', endDate: '2026-11-26T23:59:59Z' });
  assert.strictEqual(ok.success, true);
  const bad = v.fiatStats.query.safeParse({ startDate: 'zapqaxxx', endDate: '2026-11-26' });
  assert.strictEqual(bad.success, false);
});
