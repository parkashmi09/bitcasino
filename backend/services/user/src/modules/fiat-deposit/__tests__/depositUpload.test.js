'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const express = require('express');

const db = require('@ibitplay/db');
const { createLogger, errorHandler } = require('@ibitplay/common');

/**
 * The deposit route's upload, over HTTP (multer + validator + service).
 *
 * A file that isn't a JPG/PNG/PDF used to be dropped silently by multer's
 * `fileFilter`, so the player was told FIAT_DEPOSIT_SCREENSHOT_REQUIRED ("attach a
 * screenshot") although they had attached one. The service sniffs the bytes
 * anyway, so the route now hands every file over and the refusal names the
 * real problem: FIAT_DEPOSIT_INVALID_SCREENSHOT.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const TAG = `u${process.pid % 100000}`;

test('fiat deposit upload', async (t) => {
  const logger = createLogger({ name: 'fiat-upload-test', level: 'silent' });
  let connection;
  try {
    connection = await db.connect({
      config: {
        DB_HOST: process.env.DB_HOST || '127.0.0.1',
        DB_PORT: Number(process.env.DB_PORT || 5432),
        DB_NAME: TEST_DB,
        DB_USER: process.env.DB_USER || 'postgres',
        DB_PASSWORD: process.env.DB_PASSWORD || 'postgres',
        DB_SCHEMA: 'public',
      },
      logger,
      service: 'user-service',
    });
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }

  const { Users, Credits, FiatDeposits } = connection.models;
  const uid = 960_000_000 + (process.pid % 100_000);
  const storage = path.join(os.tmpdir(), `ibitplay-deposit-upload-${process.pid}`);
  const wipe = async () => {
    await FiatDeposits.destroy({ where: { user_id: uid } });
    await Credits.destroy({ where: { uid } });
    await Users.destroy({ where: { id: uid } });
  };
  await wipe();
  await Users.create({ id: uid, name: `qa-upload-${TAG}`, password: 'not-a-real-hash', status: 'active' });
  await Credits.create({ uid, inr: '0' });

  const deps = {
    config: { SERVICE_NAME: 'user-service', NODE_ENV: 'test', DEPOSIT_STORAGE_DIR: storage },
    logger,
    db: connection,
    models: connection.models,
    clients: {},
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: uid, role: 'player', status: 'active' };
    next();
  });
  app.use('/deposits/fiat', require('../routes/user.routes')(deps));
  app.use(errorHandler({ logger }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await wipe();
    await fs.rm(storage, { recursive: true, force: true });
    await connection.close();
  });
  const url = `http://127.0.0.1:${server.address().port}/deposits/fiat`;

  const lodge = async (file, ref) => {
    const form = new FormData();
    form.set('amount', '500');
    form.set('currency', 'INR');
    form.set('transactionId', ref);
    if (file) form.set('screenshot', file);
    const res = await fetch(url, { method: 'POST', body: form });
    const json = await res.json().catch(() => null);
    return { status: res.status, code: json?.error?.code };
  };

  await t.test('a text file is refused as an invalid screenshot, not a missing one', async () => {
    const r = await lodge(new File(['hello'], 'note.txt', { type: 'text/plain' }), `QA-${TAG}-txt`);
    assert.equal(r.status, 422);
    assert.equal(r.code, 'FIAT_DEPOSIT_INVALID_SCREENSHOT');
  });

  await t.test('a file claiming image/png without PNG bytes is refused the same way', async () => {
    const r = await lodge(new File(['not a png'], 'fake.png', { type: 'image/png' }), `QA-${TAG}-fake`);
    assert.equal(r.code, 'FIAT_DEPOSIT_INVALID_SCREENSHOT');
  });

  await t.test('no file at all is still SCREENSHOT_REQUIRED', async () => {
    const r = await lodge(null, `QA-${TAG}-none`);
    assert.equal(r.code, 'FIAT_DEPOSIT_SCREENSHOT_REQUIRED');
  });

  await t.test('a real PNG is lodged', async () => {
    const r = await lodge(new File([PNG], 'shot.png', { type: 'image/png' }), `QA-${TAG}-ok`);
    assert.equal(r.status, 201);
    assert.equal(await FiatDeposits.count({ where: { user_id: uid } }), 1, 'only the valid one was written');
  });
});
