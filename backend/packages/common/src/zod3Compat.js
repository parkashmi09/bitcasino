'use strict';

/**
 * Keeps validation errors exactly as they were under zod 3.
 *
 * The frontends show `details[].message` and read `details[].code`, and zod 4
 * rewrote both (`Required` became `Invalid input: expected string, received
 * undefined`, `invalid_string` became `invalid_format`, ...). This module:
 *   - installs a zod 3 English locale as zod 4's default messages (on require);
 *   - `v3Issues()` turns zod 4 issues back into the zod 3 list: codes renamed,
 *     and union/record-key issues unwrapped the way zod 3 reported them.
 * Custom messages (`.min(3, 'too short')`, `{ error }`) win over both, as before.
 */

const { z } = require('zod');

const quote = (v) => (typeof v === 'string' ? `'${v}'` : String(v));
const join = (values, sep = ' | ') => values.map(quote).join(sep);

/** zod 3's name for the type of a value (ZodParsedType). */
function parsedType(v) {
  switch (typeof v) {
    case 'number':
      return Number.isNaN(v) ? 'nan' : 'number';
    case 'object':
      if (v === null) return 'null';
      if (Array.isArray(v)) return 'array';
      if (v instanceof Date) return 'date';
      if (v instanceof Map) return 'map';
      if (v instanceof Set) return 'set';
      if (typeof v.then === 'function') return 'promise';
      return 'object';
    default:
      return typeof v;
  }
}

/**
 * The zod 3 message for a zod 4 issue. Where zod 3 used another code, it is
 * left on the raw issue as `v3code` (finalizeIssue copies the issue's keys
 * after the message is made) for v3Issues to apply.
 */
function v3Message(issue) {
  switch (issue.code) {
    case 'invalid_type': {
      if (issue.input === undefined) return 'Required';
      // A non-integer for .int(): zod 3 said "Expected integer, received float".
      if (issue.expected === 'int') return `Expected integer, received ${Number.isNaN(issue.input) ? 'nan' : 'float'}`;
      if (issue.expected === 'date' && issue.input instanceof Date) {
        issue.v3code = 'invalid_date';
        return 'Invalid date';
      }
      const received = parsedType(issue.input);
      // ±Infinity: zod 3 only refused it under .finite().
      if (issue.expected === 'number' && received === 'number') {
        issue.v3code = 'not_finite';
        return 'Number must be finite';
      }
      return `Expected ${issue.expected === 'record' ? 'object' : issue.expected}, received ${received}`;
    }
    case 'invalid_value':
      if (issue.inst?._zod?.def?.type === 'literal') {
        issue.v3code = 'invalid_literal';
        return `Invalid literal value, expected ${JSON.stringify(issue.values[0])}`;
      }
      // zod 3 checked an enum's input type first.
      if (typeof issue.input !== 'string') {
        issue.v3code = 'invalid_type';
        return issue.input === undefined ? 'Required' : `Expected ${join(issue.values)}, received ${parsedType(issue.input)}`;
      }
      issue.v3code = 'invalid_enum_value';
      return `Invalid enum value. Expected ${join(issue.values)}, received '${issue.input}'`;
    case 'unrecognized_keys':
      return `Unrecognized key(s) in object: ${join(issue.keys, ', ')}`;
    case 'invalid_format':
      switch (issue.format) {
        case 'regex':
          return 'Invalid';
        case 'starts_with':
          return `Invalid input: must start with "${issue.prefix}"`;
        case 'ends_with':
          return `Invalid input: must end with "${issue.suffix}"`;
        case 'includes':
          return `Invalid input: must include "${issue.includes}"`;
        default:
          return `Invalid ${issue.format}`;
      }
    case 'too_small': {
      const { origin, minimum: n, exact, inclusive } = issue;
      if (origin === 'array' || origin === 'set') return `Array must contain ${exact ? 'exactly' : inclusive ? 'at least' : 'more than'} ${n} element(s)`;
      if (origin === 'string') return `String must contain ${exact ? 'exactly' : inclusive ? 'at least' : 'over'} ${n} character(s)`;
      if (origin === 'number' || origin === 'int' || origin === 'bigint') return `Number must be ${exact ? 'exactly equal to ' : inclusive ? 'greater than or equal to ' : 'greater than '}${n}`;
      if (origin === 'date') return `Date must be ${exact ? 'exactly equal to ' : inclusive ? 'greater than or equal to ' : 'greater than '}${new Date(Number(n))}`;
      return 'Invalid input';
    }
    case 'too_big': {
      const { origin, maximum: n, exact, inclusive } = issue;
      if (origin === 'array' || origin === 'set') return `Array must contain ${exact ? 'exactly' : inclusive ? 'at most' : 'less than'} ${n} element(s)`;
      if (origin === 'string') return `String must contain ${exact ? 'exactly' : inclusive ? 'at most' : 'under'} ${n} character(s)`;
      if (origin === 'number' || origin === 'int') return `Number must be ${exact ? 'exactly' : inclusive ? 'less than or equal to' : 'less than'} ${n}`;
      if (origin === 'bigint') return `BigInt must be ${exact ? 'exactly' : inclusive ? 'less than or equal to' : 'less than'} ${n}`;
      if (origin === 'date') return `Date must be ${exact ? 'exactly' : inclusive ? 'smaller than or equal to' : 'smaller than'} ${new Date(Number(n))}`;
      return 'Invalid input';
    }
    case 'not_multiple_of':
      return `Number must be a multiple of ${issue.divisor}`;
    case 'invalid_union':
      return issue.note === 'No matching discriminator' ? `Invalid discriminator value. Expected ${join(issue.options ?? [])}` : 'Invalid input';
    default:
      return 'Invalid input';
  }
}

z.config({ localeError: (issue) => v3Message(issue) });

const V3_CODES = { invalid_format: 'invalid_string' };

/** An issue from a check (zod 3 "dirty"), not from the base type parse (zod 3 "aborted"). */
const isCheckIssue = (i) =>
  !['invalid_type', 'invalid_value', 'invalid_union', 'invalid_key', 'invalid_element'].includes(i.code) ||
  (i.code === 'invalid_type' && i.expected === 'int');

/**
 * zod 4 issues as zod 3 reported them.
 *
 * Unions: zod 3 returned the issues of the first branch that got past the
 * type check (a string failing both `.datetime()` and `.date()` said "Invalid
 * datetime"); only when every branch failed on type did it say "Invalid input".
 * Record keys: zod 3 reported the key schema's own issue at the key's path.
 * A value of the wrong type: zod 3 stopped there; zod 4 can still run the
 * checks after it (`z.array().max(2)` on "abc" adds a string too_big).
 */
function v3Issues(issues, prefix = []) {
  const out = [];
  const wrongType = new Set();
  for (const issue of issues) {
    const path = [...prefix, ...issue.path];
    const at = JSON.stringify(path);
    if (wrongType.has(at)) continue;
    if (issue.code === 'invalid_type' && issue.expected !== 'int') wrongType.add(at);
    if (issue.code === 'invalid_union' && issue.errors?.length) {
      const dirty = issue.errors.find((branch) => branch.every(isCheckIssue));
      if (dirty) {
        out.push(...v3Issues(dirty, path));
        continue;
      }
    }
    if (issue.code === 'invalid_key' && issue.issues?.length) {
      out.push(...v3Issues(issue.issues, path));
      continue;
    }
    const { v3code, input, ...rest } = issue;
    let code = v3code ?? V3_CODES[issue.code] ?? issue.code;
    // A custom message skips the locale, so no v3code: decide from the input (parse with reportInput).
    if (code === 'invalid_value') {
      if (issue.values?.length === 1) code = 'invalid_literal';
      else code = 'input' in issue && typeof input !== 'string' ? 'invalid_type' : 'invalid_enum_value';
    }
    if (code === 'invalid_union' && issue.note === 'No matching discriminator') code = 'invalid_union_discriminator';
    out.push({ ...rest, path, code });
  }
  return out;
}

module.exports = { v3Issues, v3Message };
