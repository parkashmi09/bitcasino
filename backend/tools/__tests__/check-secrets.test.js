'use strict';

/**
 * tools/check-secrets.js stores only SHA-256 hashes of the compromised values.
 * These tests prove the hashes still catch the real thing — WITHOUT this file
 * containing, or any assertion message printing, a single value.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const { COMPROMISED, findCompromised, sha256 } = require('../check-secrets');

const TOOLS = path.resolve(__dirname, '..');

const fake = (value, extra = {}) => ({
  id: 'fake',
  sha256: sha256(value),
  length: value.length,
  found: 'test',
  opens: 'test',
  ...extra,
});

test('the checker holds hashes, not values', () => {
  assert.ok(COMPROMISED.length >= 16);
  for (const entry of COMPROMISED) {
    assert.match(entry.sha256, /^[0-9a-f]{64}$/);
    assert.ok(Number.isInteger(entry.length) && entry.length > 0);
    assert.ok(!('pattern' in entry), `${entry.id} still carries a pattern`);
  }
});

test('a hashed value is found in code, in a comment, inside a longer token, and nowhere else', () => {
  const secret = 'not-a-real-secret-7f3a9c';
  const entries = [fake(secret)];

  assert.equal(findCompromised(`const key = '${secret}';`, entries).length, 1);
  assert.equal(findCompromised(`  // was: ${secret}`, entries).length, 1);
  assert.equal(findCompromised(`file: ${secret}-adminsdk.json`, entries).length, 1);
  assert.equal(findCompromised(`mail: user.${secret}`, entries).length, 1);
  assert.equal(findCompromised('const key = process.env.KEY;', entries).length, 0);
  assert.equal(findCompromised(`a\nb ${secret}\nc`, entries)[0].line, 2);
});

/**
 * The real check: pull one value out of the PRE-redaction checker in git
 * history, in memory, and prove the current hash list catches it.
 */
test('an old value from git history is still detected (in memory, never printed)', (t) => {
  let commits;
  try {
    commits = execFileSync('git', ['rev-list', '-n', '200', 'HEAD', '--', 'check-secrets.js'], {
      cwd: TOOLS,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .split('\n')
      .filter(Boolean);
  } catch {
    return t.skip('no git history available');
  }

  let value = null;
  let id = null;
  for (const commit of commits) {
    let source;
    try {
      source = execFileSync('git', ['show', `${commit}:./check-secrets.js`], {
        cwd: TOOLS,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toString();
    } catch {
      continue;
    }
    const match = source.match(/id: '([^']+)',\s*\n\s*pattern: \/([^/\n]+)\/,/);
    if (match) {
      id = match[1];
      value = match[2].replace(/\\(.)/g, '$1');
      break;
    }
  }
  if (!value) return t.skip('no pre-redaction checker in this history');

  const entry = COMPROMISED.find((candidate) => candidate.id === id);
  assert.ok(entry, `no hash entry for ${id}`);
  assert.ok(sha256(value) === entry.sha256, `hash for ${id} does not match its old value`);

  const hits = findCompromised(`const leaked = "${value}"; // ${value}`);
  assert.ok(hits.length === 1 && hits[0].entry.id === id, `${id} was not detected`);
});

test('the CLI passes on the current tree', () => {
  const run = spawnSync(process.execPath, [path.join(TOOLS, 'check-secrets.js')], { encoding: 'utf8' });
  assert.ok(run.status === 0, 'check-secrets.js exited non-zero');
  assert.match(run.stdout, /No known-compromised secret/);
});
