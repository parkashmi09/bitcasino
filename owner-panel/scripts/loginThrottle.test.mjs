// Owner login throttle client key (src/lib/auth/throttle.ts): a client-supplied x-forwarded-for entry
// must not pick the bucket. Run: node --test scripts/loginThrottle.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'

import { loginClient } from '../src/lib/auth/throttle.ts'

test('takes the entry written by the trusted proxy, not the client-supplied ones', () => {
  assert.equal(loginClient('6.6.6.6, 1.2.3.4', 1), '1.2.3.4')
  assert.equal(loginClient('6.6.6.6, 1.2.3.4, 10.0.0.1', 2), '1.2.3.4')
})

test('no trusted proxy or no header: one shared bucket', () => {
  assert.equal(loginClient('6.6.6.6', 0), 'direct')
  assert.equal(loginClient(null, 1), 'direct')
  assert.equal(loginClient('1.2.3.4', 3), 'direct')
})
