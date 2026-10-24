'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');

const { createActivityRecorder } = require('../src/middleware/activity');

/**
 * `describe` runs on `res` finish, but a CREATE learns its target id only in
 * the handler — so `user.create` audit rows had `target_id` NULL. The handler
 * now leaves the id on `res.locals.activityTargetId` and the recorder uses it
 * when `describe` did not name one.
 */
test('activity target id from res.locals', async (t) => {
  const run = async (describe, locals) => {
    const posted = [];
    const withActivity = createActivityRecorder({
      client: { post: async (_path, body) => posted.push(body) },
      logger: null,
      serviceName: 'admin-service',
    });
    const req = { staff: { id: 1 }, method: 'POST', originalUrl: '/x', headers: {}, ip: '::1' };
    const res = Object.assign(new EventEmitter(), { statusCode: 201, locals: locals ?? {} });
    withActivity({ action: 'user.create', describe })(req, res, () => {});
    res.emit('finish');
    await new Promise((r) => setImmediate(r));
    return posted[0];
  };

  await t.test('a created id left by the handler becomes the target', async () => {
    const entry = await run(() => ({ targetType: 'USER' }), { activityTargetId: '77' });
    assert.equal(entry.targetId, '77');
    assert.equal(entry.targetType, 'USER');
  });

  await t.test('an explicit targetId from describe wins', async () => {
    const entry = await run(() => ({ targetType: 'USER', targetId: '5' }), { activityTargetId: '77' });
    assert.equal(entry.targetId, '5');
  });
});
