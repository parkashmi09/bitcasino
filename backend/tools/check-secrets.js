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
 *
 * HASHES, NOT VALUES (2026-10-10)
 *
 * This file used to hold every value as a regex, which made the checker itself
 * one more copy of the leak. It now stores only the SHA-256 of each value and
 * its length. Every token in a scanned file is cut into candidate windows of
 * exactly those lengths (whole token, from each `._@-` boundary, and the token's
 * tail) and each candidate is hashed and compared. The values were redacted from
 * docs and comments at the same time, so a hit is now reported even inside a
 * comment. They remain in git history — see docs/ROTATION.md: ROTATE them.
 * ═════════════════════════════════════════════════════════════════════════
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/** Directories that must never contain a known-compromised value. */
const SCANNED = ['services', 'packages', 'gateway', 'tools', 'scripts', 'docs'];

/**
 * The rotation list, as SHA-256 hashes of the exact value.
 *
 * Each entry names WHERE it was found and WHAT it opens, because a hit needs
 * to be actionable by whoever trips it — not just "secret detected".
 */
const COMPROMISED = [
  {
    id: 'player-jwt-secret',
    sha256: 'efcd18978afce303035e199f0a610f4ed1d1db2b74dc7c6a9183aa0e321913be',
    length: 15,
    found: 'legacy/Users/Rule.js — jwt.sign(..., "<redacted>")',
    opens: 'A session token for ANY player id. Anyone with this repository can mint one.',
  },
  {
    id: 'xgaming-callback-secret',
    sha256: '72011321e3aa32dc69b420a379c6fa9fc09d0930e23645c467542730dd633127',
    length: 10,
    found: 'legacy/index.js — SECREATEkEYCASINO',
    opens: 'The XGaming callback signature. Combined with the unsigned payload, arbitrary balance writes.',
  },
  {
    id: 'nexus-agent-token',
    sha256: 'ad1d37189d3739bb0ec9fcfe7158872dcaf469194ef3ef7d714624d8da9e24ce',
    length: 32,
    found: 'legacy/index.js — agent_token on the nexusggreu calls',
    opens: 'The aggregator account this platform plays through. Opens real-money game sessions.',
  },
  {
    id: 'ccpayment-app-secret',
    sha256: 'bc1cc3b249890034e526e3830fd3e02451ca4ee0a74f24f95a78a70f44caaa30',
    length: 32,
    found: 'legacy/index.js — appSecret',
    opens: 'The CCPayment webhook signature — a signed deposit credit.',
  },
  {
    id: 'ccpayment-app-id',
    sha256: '3d5f90d3498d4a746d17d4ffff33acb9563c10845247281be6817e6e2272dd3c',
    length: 16,
    found: 'legacy/index.js — appId',
    opens: 'Pairs with the secret above.',
  },
  {
    id: 'ekqr-key',
    sha256: '7344aaaccc7d015b87f1a0a48edc9b4f618bed99d2d242f8356b6419178e4e3c',
    length: 36,
    found: 'legacy — EkQR integration',
    opens: 'UPI deposit callbacks.',
  },
  {
    id: 'smtp-password',
    sha256: '0aec76c3e64568211bd48097dd375f0b51266f9758aea19ed5032939e8a286bc',
    length: 12,
    found: 'legacy/General/Email — nodemailer auth',
    opens: 'The support mailbox. Password-reset mail originates from it.',
  },
  {
    id: 'smtp-user',
    sha256: '5050d70959a4d829fac172932e3d8557a95f4292fe49f0f1a30e9c44239265ce',
    length: 22,
    found: 'legacy/General/Email',
    opens: 'Pairs with the password above.',
  },
  {
    id: 'seamless-secret',
    sha256: '967ef7fc4f8e1a9fa3c2f2e8de1b85584f935e57ba7154f2ca80cbeaf4b88aeb',
    length: 22,
    found: 'legacy/index.js — SECRET_KEY for the seamless casino',
    opens: 'Seamless wallet callbacks.',
  },
  {
    id: 'firebase-service-account',
    sha256: '66652c6a93d78ee44256d21e4762d691bad34ba904b8fba2606be609f35bce8f',
    length: 35,
    // Matches the START of a token: the committed file name continues past it.
    prefix: true,
    found: 'committed as a .json service-account key',
    opens: 'Push to every device the Firebase project knows, and read the project data.',
  },
  {
    id: 'legacy-agent-code',
    sha256: 'd79b6f2587af35f7be9885d72531a99b112441f09476b7d25018d7f54f633a4e',
    length: 9,
    found: 'legacy/index.js — agent_code',
    opens: 'Identifies the aggregator account; pairs with the agent token.',
  },
  {
    id: 'slotegrator-casino-key',
    sha256: '318c900df6a867200f13804919c1c98bc335495bce548501c041017c3733640a',
    length: 40,
    found: 'legacy/gis/controller.js — M_KEY',
    opens: 'Signs Slotegrator casino calls, and verifies their wallet callbacks to us.',
  },
  {
    id: 'slotegrator-casino-id',
    sha256: 'e783a2f6a4f8216722ef27cc3b824feee744127d2e96cf12667eab59bed9fc51',
    length: 32,
    found: 'legacy/gis/controller.js — M_ID',
    opens: 'The casino merchant account; pairs with the key above.',
  },
  {
    id: 'slotegrator-sportsbook-key',
    sha256: '783ae2031724535cbf3f5594ed5c6baada90b03b22c1ebdfdf9b9d2cfd76cec3',
    length: 40,
    found: 'legacy/sportsbook/controller.js — M_KEY (staging)',
    opens: 'Signs Slotegrator betting calls. Staging, but the account is real.',
  },
  {
    id: 'slotegrator-sportsbook-id',
    sha256: '96aca9025f48705731f9f617f27ebd44e2de71d53e781e1074bc76a6a3cae5c5',
    length: 32,
    found: 'legacy/sportsbook/controller.js — M_ID (staging)',
    opens: 'The sportsbook merchant account; pairs with the key above.',
  },
  {
    id: 'evo-transfer-wallet-token',
    sha256: '8aea3078e3716a6640cffb2813b3f9ea734ed9f2d44bd1aa424e02dd15b4947b',
    length: 32,
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

/** Characters a credential token is made of; anything else separates tokens. */
const TOKEN_SPLIT = /[^A-Za-z0-9_@.\-]+/;
/** Inside a token, a candidate may also start right after one of these. */
const INNER_BOUNDARY = /[._@\-]/;

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

/**
 * Every substring of `line` worth hashing for the given lengths.
 *
 * Not every substring — that is a hash per character per length. A leaked value
 * sits as a whole token (`"abc123"`), at the start of one (`<value>-key.json`),
 * at its end, or after a separator inside it (`agent=<value>` is already split,
 * `user.<value>` is not).
 */
function candidates(line, lengths) {
  const out = new Set();
  for (const token of line.split(TOKEN_SPLIT)) {
    if (token.length < lengths.min) continue;
    const starts = [0];
    for (let i = 0; i < token.length; i += 1) {
      if (INNER_BOUNDARY.test(token[i])) starts.push(i + 1);
    }
    for (const length of lengths.all) {
      if (length > token.length) break;
      for (const start of starts) {
        if (start + length <= token.length) out.add(token.slice(start, start + length));
      }
      out.add(token.slice(token.length - length));
    }
  }
  return out;
}

/** Lengths to try, smallest first, derived from the entries themselves. */
function lengthsOf(entries) {
  const all = [...new Set(entries.map((entry) => entry.length))].sort((a, b) => a - b);
  return { all, min: all[0] };
}

/**
 * Known-compromised values on each line of `text`, as `{ id, line }` — never the
 * value itself, so a report can be pasted anywhere.
 */
function findCompromised(text, entries = COMPROMISED) {
  const lengths = lengthsOf(entries);
  const byHash = new Map(entries.map((entry) => [entry.sha256, entry]));
  const found = [];
  for (const [index, line] of text.split('\n').entries()) {
    const seen = new Set();
    for (const candidate of candidates(line, lengths)) {
      const entry = byHash.get(sha256(candidate));
      if (!entry || entry.length !== candidate.length || seen.has(entry.id)) continue;
      seen.add(entry.id);
      found.push({ entry, line: index + 1 });
    }
  }
  return found;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|mjs|cjs|json|ya?ml|env|sh|md)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function main() {
  const files = SCANNED.flatMap((dir) => walk(path.join(ROOT, dir)));
  const hits = [];
  const suspicious = [];

  for (const file of files) {
    const relative = path.relative(ROOT, file);
    const source = fs.readFileSync(file, 'utf8');

    /**
     * Comments count. They used to be exempt because the port quoted every
     * value it replaced; those quotes are redacted now, so a value in a comment
     * is a value in the repository.
     */
    for (const { entry, line } of findCompromised(source)) {
      hits.push({ ...entry, file: relative, line });
    }

    // The credential-shape sweep is for code; prose talks about passwords.
    if (/\.md$/.test(relative)) continue;
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
      `\n✔ No known-compromised secret in the ported code (${files.length} files, ${COMPROMISED.length} hashes).\n` +
        '  This says nothing about whether they have been ROTATED — see docs/ROTATION.md.\n\n'
    );
  }

  // Suspicious findings are a warning; a known-compromised value is a failure.
  process.exit(hits.length ? 1 : 0);
}

module.exports = { COMPROMISED, findCompromised, sha256 };

if (require.main === module) main();
