// The owner screen's working copy (src/lib/entitlements/draft.ts): a fresh load is the saved
// document unchanged, and only a deliberate pick in a variant dropdown edits it.
//   node --test scripts/draft.test.mjs        (Node 22.18+ strips the .ts types itself)
import assert from 'node:assert/strict'
import test from 'node:test'

import { buildDraft, isOwnerPick } from '../src/lib/entitlements/draft.ts'

const doc = {
  template: 'carbon_gold',
  features: { push_notifications: true, analytics: true, raffles: false },
  flags: { casino: true, lotto: false },
  variants: { push_notifications: 'onesignal', analytics: 'gtm', raffles: 'none' },
  options: { spin_wheel: { grant_on_registration: true, grant_on_every_deposit: true } }
}

const fields = d => ({ template: d.template, features: d.features, flags: d.flags, variants: d.variants, options: d.options })

test('a fresh load (no edits) is exactly the saved document, so there is nothing to save', () => {
  assert.deepEqual(buildDraft(doc, null), fields(doc))
  assert.equal(buildDraft(doc, null).variants.push_notifications, 'onesignal')
  assert.equal(buildDraft(doc, null).features.push_notifications, true)
})

test('edits land on top of the document and never mutate it', () => {
  const draft = buildDraft(doc, { variants: { push_notifications: 'none' }, features: { push_notifications: false } })

  assert.equal(draft.variants.push_notifications, 'none')
  assert.equal(draft.features.push_notifications, false)
  assert.equal(draft.variants.analytics, 'gtm')
  assert.equal(doc.variants.push_notifications, 'onesignal')
})

test('only an item press in the open list changes a variant', () => {
  assert.equal(isOwnerPick('item-press'), true)

  // Browser autofill / form restore of the hidden input and type-ahead over a closed trigger.
  for (const reason of ['none', undefined, 'keyboard', 'list-navigation']) assert.equal(isOwnerPick(reason), false, String(reason))
})

test('the withdrawals master switch: carried from the document, an edit wins, absent stays absent', () => {
  assert.equal('withdrawalsEnabled' in buildDraft(doc, null), false)
  assert.equal(buildDraft({ ...doc, withdrawalsEnabled: true }, null).withdrawalsEnabled, true)
  assert.equal(buildDraft({ ...doc, withdrawalsEnabled: true }, { withdrawalsEnabled: false }).withdrawalsEnabled, false)
  assert.equal(buildDraft({ ...doc, withdrawalsEnabled: false }, null).withdrawalsEnabled, false)
})
