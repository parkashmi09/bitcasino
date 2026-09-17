/**
 * Diff the client's socket event table against the backend's own.
 *
 * ## Why this exists at all
 *
 * The event names are opaque hashes and they ARE the protocol. One character
 * different and the event silently stops working: the server listens on one
 * string, the client sends another, and **neither side errors**. No 404, no
 * refusal, no reply — the request just sits there until the ack times out.
 *
 * The backend has a test pinning its table byte-for-byte against the legacy
 * constant file, and `createSocketServer.on()` refuses to register a name that
 * is not in it, so a typo there fails at boot. The client has no such
 * backstop: `apps/web/src/lib/socketEvents.js` is a hand-copied subset, and a
 * mistyped character in it is invisible until a player's deposit address never
 * arrives.
 *
 * This is that backstop. It reads both tables and asserts every name the
 * client declares is present in the backend's, byte for byte.
 *
 *     npm run verify:socket-events   # from apps/web, or the repo root
 *
 * NOT `verify:sockets` — `backend/package.json` already has a script by that
 * name (`tools/socket-inventory.js`) doing something entirely different, and
 * it reports `0/0` with a "do not treat this as a pass" warning when the
 * `legacy/` tree it diffs against is absent, as it is here. Two checks sharing
 * one name is how a green line gets read as covering something it never ran.
 *
 * It reads files rather than importing `@ibitplay/socket`, because the backend
 * is CommonJS in a separate workspace with its own `node_modules` and this
 * script must run without installing it.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { EVENTS, LITERAL_EVENTS } from '../src/lib/socketEvents.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND_EVENTS = join(HERE, '..', '..', '..', 'backend', 'packages', 'socket', 'src', 'events.js');

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

if (!existsSync(BACKEND_EVENTS)) {
  console.log(`\n${red('✗')} backend event table not found at ${BACKEND_EVENTS}`);
  console.log(`  ${dim('The backend workspace is required for this check.')}\n`);
  process.exit(1);
}

/**
 * Parse `NAME: "hash",` out of the backend table.
 *
 * A regex rather than an import: the file is CommonJS in another workspace,
 * and the shape it declares is stable and simple enough that parsing it is
 * more robust than arranging to `require` it from an ESM script.
 */
const source = readFileSync(BACKEND_EVENTS, 'utf8');
const backend = new Map();
for (const match of source.matchAll(/^\s{2}([A-Z0-9_]+):\s*"([^"]+)"/gm)) {
  backend.set(match[1], match[2]);
}

/**
 * The LITERAL table, which is a separate export and is quoted differently.
 *
 * `EVENTS` holds hashes in DOUBLE quotes; `LITERAL_EVENTS` holds plain names
 * in SINGLE ones. Both live in the same file at the same indentation, so the
 * quote character is the only thing the regex above has to tell them apart by
 * — which is also why a literal must never be added to the client's `EVENTS`:
 * it would be reported as "not in the backend table at all" by a check that
 * structurally cannot see it.
 */
const backendLiterals = new Map();
for (const match of source.matchAll(/^\s{2}([A-Z0-9_]+):\s*'([^']+)'/gm)) {
  backendLiterals.set(match[1], match[2]);
}

if (backend.size === 0) {
  console.log(`\n${red('✗')} parsed 0 events out of the backend table — its shape changed\n`);
  process.exit(1);
}

console.log(`\nSocket event table  ${dim(`${Object.keys(EVENTS).length} client / ${backend.size} backend`)}\n`);

let failures = 0;

for (const [name, hash] of Object.entries(EVENTS)) {
  const expected = backend.get(name);

  if (expected === undefined) {
    console.log(`  ${red('✗')} ${name} — not in the backend table at all`);
    failures += 1;
    continue;
  }

  if (expected !== hash) {
    console.log(`  ${red('✗')} ${name} — wire name does not match`);
    console.log(`    ${dim('client ')} ${hash}`);
    console.log(`    ${dim('backend')} ${expected}`);
    failures += 1;
    continue;
  }

  console.log(`  ${green('✓')} ${name} ${dim(hash)}`);
}

for (const [name, wire] of Object.entries(LITERAL_EVENTS)) {
  const expected = backendLiterals.get(name);

  if (expected === undefined) {
    console.log(`  ${red('✗')} ${name} — not in the backend LITERAL table`);
    failures += 1;
    continue;
  }

  if (expected !== wire) {
    console.log(`  ${red('✗')} ${name} — wire name does not match`);
    console.log(`    ${dim('client ')} ${wire}`);
    console.log(`    ${dim('backend')} ${expected}`);
    failures += 1;
    continue;
  }

  console.log(`  ${green('✓')} ${name} ${dim(`${wire}  (literal)`)}`);
}

console.log(`\n${'─'.repeat(70)}`);
if (failures) {
  console.log(`${red(`${failures} event name(s) would silently do nothing`)}\n`);
  process.exit(1);
}
console.log(`${green('every client event name matches the backend byte for byte')}\n`);
