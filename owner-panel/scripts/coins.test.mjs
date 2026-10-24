// Custom coin rules (coin management phase B) — what PUT /api/owner/entitlements accepts.
//   node --test scripts/coins.test.mjs        (Node 22.18+ strips the .ts types itself)
import assert from 'node:assert/strict'
import test from 'node:test'

import { coinProblem, cleanCoin, diffCoins, droppedCoins, isBuiltinCoin } from '../src/lib/entitlements/coins.ts'

const qac = (over = {}) => ({ code: 'QAC', kind: 'points', name: 'QA coin', symbol: 'QAC', decimals: 2, usdRate: '0.01', networks: [], enabled: true, ...over })

test('a valid definition passes', () => {
  assert.equal(coinProblem(qac()), null)
  assert.equal(coinProblem(qac({ kind: 'crypto', decimals: 8, networks: [{ key: 'TRC20', name: 'Tron' }] })), null)
  assert.equal(coinProblem(qac({ decimals: 0, usdRate: '125' })), null)
})

test('the code is a new, well-formed one', () => {
  assert.match(coinProblem(qac({ code: 'qac' })), /capital/)
  assert.match(coinProblem(qac({ code: 'Q' })), /capital/)
  assert.match(coinProblem(qac({ code: 'ABCDEFGHIJK' })), /capital/)
  assert.match(coinProblem(qac({ code: '1QA' })), /capital/)
  assert.match(coinProblem(qac({ code: 'USDT' })), /built-in/)
  assert.equal(isBuiltinCoin('inr'), true)
})

test('kind, name, decimals and rate are checked', () => {
  assert.match(coinProblem(qac({ kind: 'stock' })), /kind/)
  assert.match(coinProblem(qac({ name: '  ' })), /name/)
  assert.match(coinProblem(qac({ name: '<script>' })), /name/)
  assert.match(coinProblem(qac({ decimals: 9 })), /decimals/)
  assert.match(coinProblem(qac({ decimals: -1 })), /decimals/)
  assert.match(coinProblem(qac({ decimals: 2.5 })), /decimals/)
  assert.match(coinProblem(qac({ usdRate: '0' })), /USD rate/)
  assert.match(coinProblem(qac({ usdRate: '-1' })), /USD rate/)
  assert.match(coinProblem(qac({ usdRate: '0.000000001' })), /USD rate/)
  assert.match(coinProblem(qac({ usdRate: 0.01 })), /USD rate/)
  assert.match(coinProblem(qac({ enabled: 'yes' })), /enabled/)
})

test('networks: crypto only, key + name, no duplicates', () => {
  assert.match(coinProblem(qac({ networks: [{ key: 'TRC20', name: 'Tron' }] })), /only a crypto/)
  assert.match(coinProblem(qac({ kind: 'crypto', networks: [{ key: 'bad key', name: 'x' }] })), /network key/)
  assert.match(coinProblem(qac({ kind: 'crypto', networks: [{ key: 'TRC20', name: '' }] })), /needs a name/)
  assert.match(coinProblem(qac({ kind: 'crypto', networks: [{ key: 'TRC20', name: 'a' }, { key: 'TRC20', name: 'b' }] })), /twice/)
})

test('cleanCoin fills the symbol and drops networks off crypto', () => {
  assert.deepEqual(cleanCoin(qac({ symbol: ' ', name: ' QA coin ' })), qac({ symbol: 'QAC', name: 'QA coin' }))
})

test('diffCoins: one `coin` change per added, edited, switched coin', () => {
  assert.deepEqual(diffCoins([], [qac()]).map(c => [c.kind, c.key, c.action]), [['coin', 'QAC', 'added']])
  assert.deepEqual(diffCoins([qac()], [qac()]), [])
  assert.deepEqual(diffCoins([qac()], [qac({ enabled: false })]).map(c => c.action), ['disabled'])
  assert.deepEqual(diffCoins([qac({ enabled: false })], [qac()]).map(c => c.action), ['enabled'])
  assert.deepEqual(diffCoins([qac()], [qac({ usdRate: '0.02' })]).map(c => c.action), ['edited'])
  assert.deepEqual(diffCoins([qac()], [qac({ usdRate: '0.02', enabled: false })]).map(c => c.action), ['edited'])
})

test('a coin is never removed (and so its code never changes)', () => {
  assert.deepEqual(droppedCoins([qac()], []), ['QAC'])
  assert.deepEqual(droppedCoins([qac()], [qac({ code: 'QAD' })]), ['QAC'])
  assert.deepEqual(droppedCoins([qac()], [qac({ enabled: false })]), [])
})
