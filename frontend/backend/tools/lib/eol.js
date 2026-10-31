'use strict';

/**
 * Line endings, for the tools that write generated artifacts.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 *
 * Four documents in `docs/` are generated: `API-ROUTES.md`,
 * `ROUTE-PORT-CHECKLIST.md`, `api-surface.json` and `socket-manifest.json`.
 * Every generator built its output by joining on `\n` and comparing the result
 * to the file on disk with `!==`.
 *
 * That is exact only where the working tree is LF. This repository is cloned
 * with `core.autocrlf = true` and carries no `.gitattributes`, so the blobs are
 * LF (correct) and the WORKING TREE IS CRLF (also correct). A generator that
 * emits LF therefore disagrees with the file it just read, byte for byte, while
 * agreeing with it completely in content:
 *
 *     npm run verify:api-docs
 *     → docs/API-ROUTES.md is out of date — run: node tools/api-surface.js
 *
 * and it says that forever, on a checkout where nothing is out of date. A gate
 * that cannot pass is a gate nobody reads, which is the actual cost — the
 * comparison stops being able to distinguish "the docs are stale" from "this is
 * Windows".
 *
 * (It does NOT produce a spurious git diff: `autocrlf` normalises the write
 * back to LF, so `git diff` on a regenerated file is empty. The damage is
 * confined to the check.)
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────
 *
 * Compare on CONTENT — both sides normalised to LF. Write in the ending the
 * file already uses, so a regenerate does not churn the working tree and a
 * `--check` immediately afterwards still passes.
 *
 * A file that does not exist yet is written LF, matching what git stores.
 */

const fs = require('node:fs');

/** Both endings collapsed to `\n`, for a comparison that means "same content". */
const toLf = (text) => String(text).replace(/\r\n/g, '\n');

/** Content equality that ignores how the lines happen to end. */
const sameContent = (a, b) => toLf(a) === toLf(b);

/**
 * The ending `file` already uses, as a string.
 *
 * Decided on the first line break rather than a majority vote: a file that is
 * already mixed has no meaningful majority, and the first break is what an
 * editor and a diff tool both key on.
 */
function eolOf(file) {
  if (!fs.existsSync(file)) return '\n';
  const sample = fs.readFileSync(file, 'utf8').slice(0, 65_536);
  const at = sample.indexOf('\n');
  if (at === -1) return '\n';
  return sample[at - 1] === '\r' ? '\r\n' : '\n';
}

/**
 * Write `content` to `file`, keeping the line ending the file already has.
 *
 * @returns {boolean} whether anything actually changed on disk — so a caller
 *   can say "already up to date" instead of claiming a write it did not make.
 */
function writeKeepingEol(file, content) {
  const eol = eolOf(file);
  const next = eol === '\n' ? toLf(content) : toLf(content).replace(/\n/g, '\r\n');

  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === next) return false;

  fs.writeFileSync(file, next);
  return true;
}

module.exports = { toLf, sameContent, eolOf, writeKeepingEol };
