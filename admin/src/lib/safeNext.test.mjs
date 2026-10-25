// Self-check for the post-login `?next=` guard. Run: node src/lib/safeNext.test.mjs
import assert from 'node:assert/strict'

import { safeNext } from './safeNext.ts'

for (const evil of ['/\t/evil.com', '/\n/evil.com', '/\r/evil.com', '/\\evil.com', '/.//evil.com', '/..//evil.com', '/%2e//evil.com', '/a/..//evil.com', '//evil.com', 'https://evil.com', 'javascript:alert(1)', '', null]) {
  assert.equal(safeNext(evil), '/dashboard', JSON.stringify(evil))
}

assert.equal(safeNext('/users?x=1'), '/users?x=1')
assert.equal(safeNext('/reports/bets#top'), '/reports/bets#top')

console.log('safeNext ok')
