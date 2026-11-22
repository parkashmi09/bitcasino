'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { standardEnvelope, toStandard } = require('../../../lib/standardEnvelope');

/** /internalsettle failures leave in the standard envelope `{ success:false, error:{ code, message } }`. */
test('mssports failure bodies become the standard envelope', () => {
  assert.deepEqual(toStandard(400, { success: false, error: 'bet_id is required' }), { success: false, error: { code: 'BAD_REQUEST', message: 'bet_id is required' } });
  assert.deepEqual(toStandard(404, { success: false, error: 'Open bet not found' }).error.code, 'NOT_FOUND');
  assert.deepEqual(toStandard(403, { success: false, message: 'Owner only' }), { success: false, error: { code: 'FORBIDDEN', message: 'Owner only' } });
  assert.equal(toStandard(500, { success: false, error: 'boom' }).error.code, 'INTERNAL_ERROR');
  const already = { success: false, error: { code: 'X', message: 'y' } };
  assert.equal(toStandard(400, already), already);
});

test('the middleware rewrites only failures', () => {
  const sent = [];
  const res = { statusCode: 200, json: (b) => sent.push(b) };
  standardEnvelope()({ originalUrl: '/x' }, res, () => {});
  res.json({ success: true, data: 1 });
  res.statusCode = 400;
  res.json({ success: false, error: 'nope' });
  assert.deepEqual(sent, [{ success: true, data: 1 }, { success: false, error: { code: 'BAD_REQUEST', message: 'nope' } }]);
});
