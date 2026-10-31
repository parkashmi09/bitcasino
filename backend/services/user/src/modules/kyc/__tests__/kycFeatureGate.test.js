'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { entitlements } = require('@ibitplay/common');
const userRoutes = require('../routes/user.routes');

// With the owner's KYC feature out of the plan, the player KYC routes refuse before any service call.
test('KYC user routes are closed while the KYC feature is off', async (t) => {
  entitlements.configureEntitlements({ read: async () => ({ features: { kyc: false }, flags: {}, version: 1, source: 'owner' }) });
  t.after(() => entitlements.resetEntitlements());
  const app = express();
  app.use((req, _res, next) => ((req.user = { id: 1 }), next()));
  app.use('/kyc', userRoutes({ models: {}, db: { sequelize: {} }, config: {}, logger: null }));
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ code: err.code }));
  const server = http.createServer(app).listen(0);
  t.after(() => server.close());
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/kyc/status`);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, 'NOT_ENTITLED');
});
