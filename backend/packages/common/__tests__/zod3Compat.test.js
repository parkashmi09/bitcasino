'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { validate, z } = require('../src/middleware/validate');

/** The `details` a request body gets back from validate(). */
function details(schema, body) {
  let out;
  validate({ body: schema })({ body, params: {}, query: {}, headers: {} }, {}, (err) => {
    out = err ? err.details : null;
  });
  return out;
}

test('validation details keep their zod 3 messages and codes on zod 4', () => {
  const schema = z
    .object({
      name: z.string().min(3),
      kind: z.enum(['a', 'b']),
      at: z.string().datetime({ offset: true }).or(z.string().date()),
      email: z.string().email(),
      n: z.number().int(),
    })
    .strict();

  assert.deepStrictEqual(details(schema, { name: 'x', kind: 'c', at: 'nope', email: 'nope', n: 1.5, extra: 1 }), [
    { field: 'name', message: 'String must contain at least 3 character(s)', code: 'too_small' },
    { field: 'kind', message: "Invalid enum value. Expected 'a' | 'b', received 'c'", code: 'invalid_enum_value' },
    { field: 'at', message: 'Invalid datetime', code: 'invalid_string' },
    { field: 'email', message: 'Invalid email', code: 'invalid_string' },
    { field: 'n', message: 'Expected integer, received float', code: 'invalid_type' },
    { field: 'body', message: "Unrecognized key(s) in object: 'extra'", code: 'unrecognized_keys' },
  ]);

  assert.deepStrictEqual(details(schema, { kind: 1 }).slice(0, 2), [
    { field: 'name', message: 'Required', code: 'invalid_type' },
    { field: 'kind', message: "Expected 'a' | 'b', received number", code: 'invalid_type' },
  ]);
});

test('a custom type message applies to the type issue only', () => {
  const amount = z
    .string({ error: (iss) => (iss.code === 'invalid_type' ? (iss.input === undefined ? 'amount is required' : 'send a string') : undefined) })
    .min(2);
  const schema = z.object({ amount });
  assert.strictEqual(details(schema, {})[0].message, 'amount is required');
  assert.strictEqual(details(schema, { amount: 5 })[0].message, 'send a string');
  assert.strictEqual(details(schema, { amount: 'x' })[0].message, 'String must contain at least 2 character(s)');
});
