#!/usr/bin/env node
'use strict';

/**
 * Fail if a known-compromised secret is present in the ported services.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY A CHECKER AND NOT JUST A DOCUMENT
 *
 * Every secret below is committed in `legacy/`, which means it is in the git
 * history, in every clone, and in every backup of this repository. Rotating
 * them is an operations task nobody can do from inside the codebase.
 *
 * What the codebase CAN do is refuse to reintroduce them. A rotation that is
 * only written down gets undone by the first copy-paste from the old source —
 * so this runs in `npm run verify:secrets` and exits non-zero on a hit.
 *
 * `legacy/` is deliberately NOT scanned. The values are there, that is the
 * point, and a checker that fails on the thing it is documenting is a checker
 * people turn off.
 * ═════════════════════════════════════════════════════════════════════════
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/** Directories that must never contain a known-compromised value. */
const SCANNED = ['services', 'packages', 'gateway', 'tools', 'scripts'];

/**
 * The rotation list, as patterns.
 *
 * Each entry names WHERE it was found and WHAT it opens, because a hit needs
 * to be actionable by whoever trips it — not just "secret detected".
 */
const COMPROMISED = [
  {
    id: 'player-jwt-secret',
    pattern: /keyboardca4ever/,
    found: 'legacy/Users/Rule.js — jwt.sign(..., "keyboardca4ever")',
    opens: 'A session token for ANY player id. Anyone with this repository can mint one.',
  },
  {
    id: 'xgaming-callback-secret',
    pattern: /Hja934U1nz/,
    found: 'legacy/index.js — SECREATEkEYCASINO',
    opens: 'The XGaming callback signature. Combined with the unsigned payload, arbitrary balance writes.',
  },
  {
    id: 'nexus-agent-token',
    pattern: /83eb5e7c8f7a1852f61692442a5ead9c/,
    found: 'legacy/index.js — agent_token on the nexusggreu calls',
    opens: 'The aggregator account this platform plays through. Opens real-money game sessions.',
  },
  {
    id: 'ccpayment-app-secret',
    pattern: /48e60e26e298f7bb6023209f9c48b91c/,
    found: 'legacy/index.js — appSecret',
    opens: 'The CCPayment webhook signature — a signed deposit credit.',
  },
  {
    id: 'ccpayment-app-id',
    pattern: /mvEYJASPV187Zjxu/,
    found: 'legacy/index.js — appId',
    opens: 'Pairs with the secret above.',
  },
  {
    id: 'ekqr-key',
    pattern: /f51e33b6-9c24-42b2-98d2-954fc765f78d/,
    found: 'legacy — EkQR integration',
    opens: 'UPI deposit callbacks.',
  },
  {
    id: 'smtp-password',
    pattern: /camelbit@123/,
    found: 'legacy/General/Email — nodemailer auth',
    opens: 'The support mailbox. Password-reset mail originates from it.',
  },
  {
    id: 'smtp-user',
    pattern: /support@camelbit\.games/,
    found: 'legacy/General/Email',
    opens: 'Pairs with the password above.',
  },
  {
    id: 'seamless-secret',
    pattern: /KjEukDNWN6hH3hTLUHSQZm/,
    found: 'legacy/index.js — SECRET_KEY for the seamless casino',
    opens: 'Seamless wallet callbacks.',
  },
  {
    id: 'firebase-service-account',
    pattern: /bitcoinjito-e3078-firebase-adminsdk/,
    found: 'committed as a .json service-account key',
    opens: 'Push to every device the Firebase project knows, and read the project data.',
  },
  {
    id: 'legacy-agent-code',
    pattern: /Skyla_USD/,
    found: 'legacy/index.js — agent_code',
    opens: 'Identifies the aggregator account; pairs with the agent token.',
  },
  {
    id: 'slotegrator-casino-key',
    pattern: /354d31484955a6e2fadc3545775d04a28f9c644e/,
    found: 'legacy/gis/controller.js — M_KEY',
    opens: 'Signs Slotegrator casino calls, and verifies their wallet callbacks to us.',
  },
  {
    id: 'slotegrator-casino-id',
    pattern: /9088a8210aa9be9c224e9ae5efdc9976/,
    found: 'legacy/gis/controller.js — M_ID',
    opens: 'The casino merchant account; pairs with the key above.',
  },
  {
    id: 'slotegrator-sportsbook-key',
    pattern: /abf806cef2fdb1c8a5c5a12317d3c2cc892e41af/,
    found: 'legacy/sportsbook/controller.js — M_KEY (staging)',
    opens: 'Signs Slotegrator betting calls. Staging, but the account is real.',
  },
  {
    id: 'slotegrator-sportsbook-id',
    pattern: /856e1604085918d11aa5663ebd546bf7/,
    found: 'legacy/sportsbook/controller.js — M_ID (staging)',
    opens: 'The sportsbook merchant account; pairs with the key above.',
  },
  {
    id: 'evo-transfer-wallet-token',
    pattern: /fb216c4fead6630de2551643267d5ab0/,
    found: 'legacy/Slots/API/evo.js — TOKEN, with PID 3064',
    opens: 'The 8provider transfer-wallet account. Its callback is plain HTTP.',
  },
];

/**
 * A generic sweep for things that look like a secret with a literal value.
 *
 * Catches a NEW hardcoded credential rather than a known one — the failure
 * mode where somebody adds a fallback "just for local" and it ships.
 */
const SUSPICIOUS_ASSIGNMENT =
  /(secret|password|apikey|api_key|token|passphrase|private_key)\s*[:=]\s*['"`][A-Za-z0-9@._\-+/]{12,}['"`]/i;

/** Values that look like secrets and are not. */
const ALLOWED = [
  /test|example|placeholder|changeme|your[-_]?|xxx|\bfake\b|dummy/i,
  // The socket event table is 40-character hashes, not credentials.
  /packages[/\\]socket[/\\]src[/\\]events\.js/,
];

/**
 * This file holds every compromised value as a pattern, so it matches itself.
 *
 * Skipped by path rather than by some cleverness, because a checker that has to
 * reason about whether it is looking at itself is a checker with a bug waiting.
 */
const SELF = path.join(ROOT, 'tools', 'check-secrets.js');

/**
 * A credential-shaped line that is naming a SETTING, not holding a value.
 *
 *     token: 'CASINO_NEXUS_TOKEN'      ← the env var to read, not the secret
 *     RESET_PASSWORD: 'reset-password' ← a template name
 *
 * An UPPER_SNAKE_CASE value or a kebab-case identifier is a name. A real
 * secret is neither.
 */
const LOOKS_LIKE_A_NAME = (line) => {
  // EVERY quoted value on the line, not just the last — a settings object puts
  // several on one line and the trailing character is a brace, not a quote.
  const values = [...line.matchAll(/['\"`]([^'\"`]+)['\"`]/g)].map((match) => match[1]);
  if (!values.length) return false;

  return values.every((value) => /^[A-Z][A-Z0-9_]*$/.test(value) || /^[a-z][a-z0-9-]*$/.test(value));
};

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|json|ya?ml|env|sh)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function main() {
  const files = SCANNED.flatMap((dir) => walk(path.join(ROOT, dir)));
  const hits = [];
  const suspicious = [];

  for (const file of files) {
    if (file === SELF) continue;

    const relative = path.relative(ROOT, file);
    const source = fs.readFileSync(file, 'utf8');

    for (const secret of COMPROMISED) {
      if (!secret.pattern.test(source)) continue;

      /**
       * A file may MENTION a compromised value in a comment — this port does
       * that constantly, because naming what was found is the point. Only an
       * occurrence outside a comment is a hit.
       */
      const lines = source.split('\n');
      for (const [index, line] of lines.entries()) {
        if (!secret.pattern.test(line)) continue;
        if (/^\s*(\/\/|\*|#|\/\*)/.test(line)) continue;

        hits.push({ ...secret, file: relative, line: index + 1 });
      }
    }

    if (ALLOWED.some((allowed) => allowed.test(relative))) continue;

    for (const [index, line] of source.split('\n').entries()) {
      if (/^\s*(\/\/|\*|#|\/\*)/.test(line)) continue;
      if (!SUSPICIOUS_ASSIGNMENT.test(line)) continue;
      if (ALLOWED.some((allowed) => allowed.test(line))) continue;
      if (LOOKS_LIKE_A_NAME(line)) continue;

      suspicious.push({ file: relative, line: index + 1, text: line.trim().slice(0, 100) });
    }
  }

  if (hits.length) {
    process.stdout.write('\n✗ A KNOWN-COMPROMISED SECRET IS PRESENT IN THE PORTED CODE\n\n');
    for (const hit of hits) {
      process.stdout.write(`  ${hit.file}:${hit.line}\n`);
      process.stdout.write(`    ${hit.id} — originally ${hit.found}\n`);
      process.stdout.write(`    Opens: ${hit.opens}\n\n`);
    }
  }

  if (suspicious.length) {
    process.stdout.write('\n⚠ Hardcoded credential-shaped values (review each):\n\n');
    for (const item of suspicious) {
      process.stdout.write(`  ${item.file}:${item.line}\n    ${item.text}\n`);
    }
    process.stdout.write('\n');
  }

  if (!hits.length && !suspicious.length) {
    process.stdout.write(
      `\n✔ No known-compromised secret in the ported code (${files.length} files, ${COMPROMISED.length} patterns).\n` +
        '  This says nothing about whether they have been ROTATED — see docs/ROTATION.md.\n\n'
    );
  }

  // Suspicious findings are a warning; a known-compromised value is a failure.
  process.exit(hits.length ? 1 : 0);
}

main();
