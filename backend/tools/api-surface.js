#!/usr/bin/env node
'use strict';

/**
 * Live API surface extractor.
 *
 *   node tools/api-surface.js            rewrite the generated block in docs/API-ROUTES.md
 *   node tools/api-surface.js --json     write docs/api-surface.json only
 *   node tools/api-surface.js --check    exit 1 if the doc is out of date
 *
 * `tools/route-inventory.js` answers "what did legacy have, and is it ported".
 * This answers the other half — "what do the four services actually serve, and
 * what comes back" — because a route table without response shapes sends a
 * client reading source to find out whether `data` is an array or an object.
 *
 * It is a STATIC read of the source. Nothing is required, so a module that
 * needs a database to load still gets documented:
 *
 *   modules/<m>/index.js         name, basePath, audiences  (the mount)
 *   modules/<m>/routes/*.js      method + path + guards     (the request)
 *   modules/<m>/controllers/*.js response helper + payload  (the reply)
 *   modules/<m>/*.errors.js      code, status, message      (the failures)
 *
 * The response column is derived from the helper the handler calls, so it
 * reports what the code does rather than what someone remembered to write down.
 * Where the payload is an object literal its top-level keys are listed verbatim;
 * where it is a variable the expression is shown instead, because inventing a
 * shape would be worse than naming the thing that produces it.
 */

const fs = require('fs');
const path = require('path');
const { toLf, sameContent, writeKeepingEol } = require('./lib/eol');

/**
 * A repo-relative path with forward slashes, on every platform.
 *
 * `path.relative` yields backslashes on Windows, so the same commit generated
 * `services/admin/...` on macOS and `services\admin\...` here. Both are
 * correct paths and neither matches the other, which is enough to make a
 * committed artifact unreproducible and its diff unreadable.
 */
const repoPath = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');

/**
 * Source, always LF.
 *
 * Several fields here are CHARACTER OFFSETS into a source file — every
 * `responses[].index`. On a CRLF working tree each preceding line contributes
 * an extra , so the same commit produced offset 211 on macOS and 215 here.
 * Normalising at the read makes every offset, and therefore the whole
 * artifact, identical on any platform.
 */
const readSource = (file) => toLf(fs.readFileSync(file, 'utf8'));

const ROOT = path.resolve(__dirname, '..');
const SERVICES_DIR = path.join(ROOT, 'services');
const DOC = path.join(ROOT, 'docs', 'API-ROUTES.md');
const JSON_OUT = path.join(ROOT, 'docs', 'api-surface.json');

const BEGIN = '<!-- BEGIN GENERATED: node tools/api-surface.js -->';
const END = '<!-- END GENERATED: node tools/api-surface.js -->';

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'all'];
const AUDIENCES = ['public', 'user', 'admin', 'internal'];

const SERVICE_PORTS = { user: 4001, admin: 4002, casino: 4003, sports: 4004 };

// ── Source text helpers ────────────────────────────────────────────────

/**
 * Strip comments without disturbing offsets inside string literals.
 *
 * Replacing comment bodies with spaces rather than deleting them keeps every
 * later index meaningful, so a match found here still points at the right place
 * in the original file when something needs to be reported.
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  let mode = 'code';
  let quote = '';

  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];

    if (mode === 'code') {
      if (c === '/' && next === '*') { mode = 'block'; out += '  '; i += 2; continue; }
      if (c === '/' && next === '/') { mode = 'line'; out += '  '; i += 2; continue; }
      if (c === "'" || c === '"' || c === '`') { mode = 'string'; quote = c; out += c; i += 1; continue; }
      out += c; i += 1; continue;
    }

    if (mode === 'string') {
      if (c === '\\') { out += c + (next ?? ''); i += 2; continue; }
      if (c === quote) { mode = 'code'; quote = ''; }
      out += c; i += 1; continue;
    }

    if (mode === 'block') {
      if (c === '*' && next === '/') { mode = 'code'; out += '  '; i += 2; continue; }
      out += c === '\n' ? '\n' : ' '; i += 1; continue;
    }

    // line comment
    if (c === '\n') { mode = 'code'; out += '\n'; i += 1; continue; }
    out += ' '; i += 1;
  }

  return out;
}

/** Read from an opening bracket to its match, returning the inner text. */
function matchBracket(src, openIndex) {
  const open = src[openIndex];
  const close = { '(': ')', '{': '}', '[': ']' }[open];
  let depth = 0;
  let i = openIndex;
  let quote = '';

  while (i < src.length) {
    const c = src[i];

    if (quote) {
      if (c === '\\') { i += 2; continue; }
      if (c === quote) quote = '';
      i += 1;
      continue;
    }

    if (c === "'" || c === '"' || c === '`') { quote = c; i += 1; continue; }
    if (c === open) depth += 1;
    else if (c === close) {
      depth -= 1;
      if (depth === 0) return { inner: src.slice(openIndex + 1, i), end: i };
    }
    i += 1;
  }

  return { inner: src.slice(openIndex + 1), end: src.length };
}

/** Split an argument list on top-level commas only. */
function splitArgs(argText) {
  const args = [];
  let depth = 0;
  let quote = '';
  let start = 0;

  for (let i = 0; i < argText.length; i += 1) {
    const c = argText[i];

    if (quote) {
      if (c === '\\') { i += 1; continue; }
      if (c === quote) quote = '';
      continue;
    }

    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if ('([{'.includes(c)) depth += 1;
    else if (')]}'.includes(c)) depth -= 1;
    else if (c === ',' && depth === 0) { args.push(argText.slice(start, i).trim()); start = i + 1; }
  }

  const last = argText.slice(start).trim();
  if (last) args.push(last);
  return args.filter(Boolean);
}

function listFiles(dir, filter = () => true) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.js') && filter(f)).map((f) => path.join(dir, f));
}

// ── Manifests ──────────────────────────────────────────────────────────

function readManifest(moduleDir) {
  const indexPath = path.join(moduleDir, 'index.js');
  if (!fs.existsSync(indexPath)) return null;

  const src = stripComments(readSource(indexPath));
  const name = src.match(/name:\s*'([^']+)'/)?.[1] || path.basename(moduleDir);
  const service = src.match(/service:\s*'([^']+)'/)?.[1] || null;
  const basePath = src.match(/basePath:\s*'([^']*)'/)?.[1] ?? '';
  const socketOnly = /socketOnly:\s*true/.test(src);

  const routersAt = src.indexOf('routers:');
  const audiences = [];
  if (routersAt !== -1) {
    const brace = src.indexOf('{', routersAt);
    if (brace !== -1) {
      const { inner } = matchBracket(src, brace);
      for (const audience of AUDIENCES) {
        if (new RegExp(`(^|[\\s{,])${audience}\\s*:`).test(inner)) audiences.push(audience);
      }
    }
  }

  const hasSockets = fs.existsSync(path.join(moduleDir, 'sockets.js'));

  /**
   * Repo-relative, like every other path in this file.
   *
   * It was the absolute `moduleDir`, so the committed `api-surface.json`
   * carried the generating machine's home directory — 66 of them — and every
   * developer who regenerated it produced a 5KB diff of nothing but their own
   * paths. A generated artifact that cannot be reproduced byte-for-byte on a
   * second machine is one nobody can check.
   */
  return { name, service, basePath, audiences, socketOnly, hasSockets, dir: repoPath(moduleDir) };
}

// ── Handler bodies ─────────────────────────────────────────────────────

/** Read an expression from `start` to the top-level `,`, `;` or `}` that ends it. */
function readExpression(src, start) {
  let depth = 0;
  let quote = '';
  let i = start;

  while (i < src.length) {
    const c = src[i];

    if (quote) {
      if (c === '\\') { i += 2; continue; }
      if (c === quote) quote = '';
      i += 1;
      continue;
    }

    if (c === "'" || c === '"' || c === '`') { quote = c; i += 1; continue; }
    if ('([{'.includes(c)) depth += 1;
    else if (')]}'.includes(c)) {
      if (depth === 0) break;
      depth -= 1;
    } else if ((c === ',' || c === ';') && depth === 0) break;

    i += 1;
  }

  return src.slice(start, i).trim();
}

/**
 * Local functions declared in a file, by name.
 *
 * These matter because most controllers are not written as one handler per
 * response call. The prevailing idiom is a tiny wrapper —
 *
 *   const ok    = (fn) => asyncHandler(async (req, res) => response.ok(res, await fn(req)));
 *   const paged = async (res, q, promise) => response.paginated(res, ...);
 *
 * — and every handler in the file is `ok(...)` or calls `paged(...)`. Reading
 * only the handler body finds no response at all and reports the route as
 * having no documented shape, which is how a first pass of this tool produced
 * 61 blank rows for routes that all answer perfectly ordinary envelopes.
 */
function collectLocalFunctions(src) {
  const locals = new Map();
  const re = /(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?=async\s*\(|\(|asyncHandler\s*\()/g;
  let m;

  while ((m = re.exec(src))) {
    const body = readExpression(src, m.index + m[0].length);
    if (body && !locals.has(m[1])) locals.set(m[1], body);
  }

  const declRe = /function\s+([a-zA-Z_$][\w$]*)\s*\(/g;
  while ((m = declRe.exec(src))) {
    // Skip the parameter list before looking for the body — a destructured
    // parameter (`function send(res, { buffer })`) opens a brace of its own,
    // and taking that one captures the parameters instead of the function.
    const paren = src.indexOf('(', m.index + m[0].length - 1);
    if (paren === -1) continue;
    const { end } = matchBracket(src, paren);
    const brace = src.indexOf('{', end);
    if (brace === -1) continue;
    const { inner } = matchBracket(src, brace);
    if (!locals.has(m[1])) locals.set(m[1], inner);
  }

  return locals;
}

/**
 * Every named handler expression in a file, by name.
 *
 * Both shapes are collected: the object property returned from a
 * `create*Controller` factory (`list: asyncHandler(...)`, `list: ok(...)`) and
 * the occasional `const list = asyncHandler(...)` declared beside a router.
 *
 * A property whose expression mentions `asyncHandler` wins over one that does
 * not, so a data key that happens to share a handler's name — `balance:` inside
 * a payload object — cannot displace the handler itself.
 */
function collectHandlers(src) {
  const handlers = new Map();

  const put = (name, expr, strong) => {
    const existing = handlers.get(name);
    if (!existing || (strong && !existing.strong)) handlers.set(name, { expr, strong });
  };

  const propRe = /(?:^|[\s{,;])([a-zA-Z_$][\w$]*)\s*:\s*(?=asyncHandler\s*\(|[a-zA-Z_$][\w$]*\s*\()/gm;
  let m;
  while ((m = propRe.exec(src))) {
    const expr = readExpression(src, m.index + m[0].length);
    if (expr) put(m[1], expr, /^asyncHandler\s*\(/.test(expr));
  }

  const constRe = /(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?=asyncHandler\s*\()/g;
  while ((m = constRe.exec(src))) {
    const expr = readExpression(src, m.index + m[0].length);
    if (expr) put(m[1], expr, true);
  }

  return new Map([...handlers].map(([name, entry]) => [name, entry.expr]));
}

/**
 * A handler's text with the local helpers it calls folded in.
 *
 * Two levels, because `list: ok(...)` reaching `ok` reaching `paged` is the
 * deepest chain in the services and an unbounded walk on a recursive helper
 * would not terminate.
 */
function expandLocals(text, locals, depth = 2) {
  let out = text;
  const seen = new Set();

  for (let round = 0; round < depth; round += 1) {
    /**
     * A qualified call resolves only under its qualified key.
     *
     * `response.ok(...)` and `envelope.ok(...)` are different functions with
     * the same tail. Matching on the bare name folds x-casino's provider
     * envelope into every ordinary `response.ok` in the service, and each of
     * those routes then documents a second, imaginary raw response.
     */
    const calls = [...out.matchAll(/(?:([a-zA-Z_$][\w$]*)\s*\.\s*)?([a-zA-Z_$][\w$]*)\s*\(/g)]
      .map(([, qualifier, name]) => (qualifier ? `${qualifier}.${name}` : name));

    let grew = false;

    for (const name of new Set(calls)) {
      if (seen.has(name) || !locals.has(name)) continue;
      seen.add(name);
      out += `\n/*↳${name}*/ ${locals.get(name)}`;
      grew = true;
    }

    if (!grew) break;
  }

  return out;
}

// ── Response extraction ────────────────────────────────────────────────

const HELPER_STATUS = { ok: 200, created: 201, accepted: 202, noContent: 204, paginated: 200 };

/** Describe an expression the way a reader needs it: shape first, name second. */
function describePayload(expr) {
  if (!expr) return null;
  // `await` is how the payload is fetched, not what it is.
  const text = expr.trim().replace(/^await\s+/, '');

  if (text.startsWith('{')) {
    const { inner } = matchBracket(text, 0);
    const keys = splitArgs(inner)
      .map((part) => {
        if (part.startsWith('...')) return part.replace(/\s+/g, ' ').slice(0, 40);
        const key = part.match(/^\s*(?:\[([^\]]+)\]|'([^']+)'|"([^"]+)"|([a-zA-Z_$][\w$]*))\s*(?::|$)/);
        return key ? (key[1] || key[2] || key[3] || key[4]) : null;
      })
      .filter(Boolean);
    return keys.length ? `{ ${keys.join(', ')} }` : '{ }';
  }

  if (text.startsWith('[')) return '[ … ]';
  if (text === 'null' || text === 'undefined') return 'null';
  if (/^(true|false|\d)/.test(text)) return text.slice(0, 40);

  /**
   * A call — name the function and elide its arguments. The arguments describe
   * the REQUEST; what a reader of a response column needs is the thing that
   * produces the payload, and `service.transferIn(…)` says that in a width
   * that fits a table cell.
   */
  const call = text.match(/^([\w$]+(?:\.[\w$]+)*(?:\[[\w$]+\])?(?:\.[\w$]+)*)\s*\(/);
  if (call) return `${call[1]}(…)`;

  // A plain identifier — name it rather than guess at its keys.
  const compact = text.replace(/\s+/g, ' ');
  return compact.length > 46 ? `${compact.slice(0, 45)}…` : compact;
}

/**
 * Every way a handler can answer, in source order.
 *
 * Ordered because the first entry is nearly always the happy path and the ones
 * after it are the conditional branches — which is exactly the distinction a
 * client needs to know a route has more than one shape.
 */
function extractResponses(body) {
  if (!body) return [];
  const found = [];

  /**
   * Turn a name that means nothing to a reader into the call that produced it.
   *
   * Two cases, both from how the controllers are written rather than anything
   * unusual:
   *
   *   const result = await service.approve(...); return response.ok(res, result);
   *      → `result` is a local, one hop from the call that fills it.
   *
   *   const ok = (fn) => asyncHandler(async (req, res) => response.ok(res, await fn(req)));
   *   inplay: ok((req) => service.inplay(req.query))
   *      → `fn` is the WRAPPER's parameter. The real call is at the handler,
   *        which is the text before the first folded-in helper.
   */
  const ownText = body.split('\n/*↳')[0];

  const clarify = (shape) => {
    if (!shape) return shape;

    const bare = shape.match(/^([a-zA-Z_$][\w$]*)$/);
    if (bare) {
      const local = new RegExp(`(?:const|let|var)\\s+${bare[1]}\\s*=\\s*`).exec(body);
      if (local) {
        const resolved = describePayload(readExpression(body, local.index + local[0].length));
        if (resolved && resolved !== shape) return resolved;
      }
      return shape;
    }

    const call = shape.match(/^([a-zA-Z_$][\w$]*)\(…\)$/);
    if (call && !/\./.test(call[1])) {
      const inner = ownText.match(/\b([a-zA-Z_$][\w$]*\.[a-zA-Z_$][\w$]*)\s*\(/);
      if (inner && inner[1] !== call[1]) return `${inner[1]}(…)`;
    }

    return shape;
  };

  const helperRe = /response\.(ok|created|accepted|noContent|paginated|fail)\s*\(/g;
  let m;
  while ((m = helperRe.exec(body))) {
    const { inner } = matchBracket(body, body.indexOf('(', m.index + m[0].length - 1));
    const args = splitArgs(inner);
    const helper = m[1];

    if (helper === 'fail') {
      found.push({ index: m.index, kind: 'fail', status: Number(args[1]) || null, shape: `error ${args[2] || ''}`.trim() });
      continue;
    }

    found.push({
      index: m.index,
      kind: helper,
      status: HELPER_STATUS[helper],
      shape: helper === 'paginated' ? '[ … ] + meta.pagination' : clarify(describePayload(args[1])),
    });
  }

  // A document written straight to the socket — `doc.pipe(res)` for a PDF.
  const pipeRe = /\.\s*pipe\s*\(\s*res\s*\)/g;
  while ((m = pipeRe.exec(body))) {
    found.push({ index: m.index, kind: 'raw', status: 200, shape: 'streamed to res' });
  }

  // Anything that answers without the envelope. These are the exceptions worth
  // naming explicitly, so they are collected with the same weight as the rest.
  const rawRe = /res\s*\.\s*(json|send|end|sendFile|redirect|type|set|setHeader|status|attachment)\s*\(/g;
  while ((m = rawRe.exec(body))) {
    const before = body.slice(Math.max(0, m.index - 12), m.index);
    if (/response\s*\.\s*$/.test(before)) continue;

    const { inner, end } = matchBracket(body, body.indexOf('(', m.index + m[0].length - 1));
    const args = splitArgs(inner);
    const verb = m[1];

    if (verb === 'status') {
      // `res.status(204).end()` and friends — the interesting part is chained.
      const tail = body.slice(end + 1, end + 40);
      const chained = tail.match(/^\s*\.\s*(json|send|end)\s*\(/);
      found.push({
        index: m.index,
        kind: 'raw',
        status: Number(args[0]) || null,
        shape: chained ? `res.${chained[1]}(…)` : `res.status(${args[0]})`,
      });
      continue;
    }

    if (verb === 'type' || verb === 'set' || verb === 'setHeader' || verb === 'attachment') {
      /**
       * Only the content type earns a row. `Cache-Control`, `Last-Modified` and
       * `X-Content-Type-Options` are policy applied to every binary route — said
       * once in §7 rather than repeated down eighteen table cells.
       */
      const clean = (text) => String(text || '').replace(/['"]/g, '').replace(/\s+/g, ' ').trim();
      let value = null;

      if (args[0]?.startsWith('{')) {
        // `res.set({ 'Content-Type': x, 'Cache-Control': y })`
        const { inner } = matchBracket(args[0], 0);
        const entry = splitArgs(inner).find((pair) => /^\s*['"]?content-type['"]?\s*:/i.test(pair));
        if (entry) value = clean(entry.slice(entry.indexOf(':') + 1));
      } else if (/^content-type$/i.test(clean(args[0]))) {
        value = clean(args[1]);
      } else if (verb === 'type') {
        value = clean(args[0]);
      }

      if (!value) continue;
      found.push({ index: m.index, kind: 'header', status: null, shape: `Content-Type: ${value.slice(0, 34)}` });
      continue;
    }

    found.push({
      index: m.index,
      kind: 'raw',
      status: null,
      shape: verb === 'json' ? `res.json(${describePayload(args[0]) || ''})` : `res.${verb}(…)`,
    });
  }

  found.sort((a, b) => a.index - b.index);

  // Collapse duplicates — the same helper with the same shape twice in a body
  // is one contract, not two.
  const seen = new Set();
  return found.filter((r) => {
    const key = `${r.kind}|${r.status}|${r.shape}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Error factories referenced directly in the handler, e.g. `errors.NOT_FOUND(`. */
function extractThrownErrors(body) {
  if (!body) return [];
  const codes = new Set();
  const re = /\berrors\.([A-Z][A-Z0-9_]*)\s*\(/g;
  let m;
  while ((m = re.exec(body))) codes.add(m[1]);
  return [...codes];
}

// ── Route files ────────────────────────────────────────────────────────

function joinPath(...parts) {
  const joined = parts.filter((p) => p && p !== '/').join('');
  return joined.replace(/\/{2,}/g, '/') || '/';
}

/**
 * Where the loader mounts a router — `mountModules` in `packages/common`.
 *
 * admin-service's own modules collapse `/admin/admin` to `/admin`: the service
 * name and the audience segment are the same word there, and the loader has the
 * same special case.
 */
function mountPrefix(audience, service, basePath) {
  if (audience === 'admin') {
    const scope = service === 'admin' ? '/admin' : `/admin/${service}`;
    return joinPath('/api/v1', scope, basePath);
  }
  if (audience === 'internal') return joinPath('/internal', `/${service}`, basePath);
  return joinPath('/api/v1', `/${service}`, basePath);
}

/**
 * Permission checks bound to a name at the top of a route file.
 *
 * Almost none of the admin routers call `requirePermission` inline. They write
 *
 *   const canManage = auth.requirePermission(PERMISSIONS.SPORTS_MANAGE);
 *
 * once and pass `canManage` to twenty routes. Reading only the literal call
 * reports every one of those as carrying no permission, which is the opposite
 * of true and the most misleading thing this table could say.
 */
function permissionAliases(src) {
  const aliases = new Map();
  const re = /(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*([^;]*?require(?:Any)?Permission\s*\([^;]*?\))\s*;/g;
  let m;

  while ((m = re.exec(src))) aliases.set(m[1], m[2]);
  return aliases;
}

/**
 * `PERMISSIONS.SPORTS_SETTLE` and `PERMISSION.VOID` both stand for a grant
 * string — `sports:settle`. The string is what a reader can compare against a
 * staff account's grants, so it is what the table prints. Resolved through the
 * platform catalogue in `@ibitplay/auth` and the module constants files that
 * alias into it.
 */
function loadPermissionValues() {
  const values = new Map();

  const record = (src, objectName) => {
    const at = src.search(new RegExp(`(?:const|let|var)\\s+${objectName}\\s*=`));
    if (at === -1) return;
    const brace = src.indexOf('{', at);
    if (brace === -1) return;
    const { inner } = matchBracket(src, brace);
    for (const [, key, value] of inner.matchAll(/([A-Z][A-Z0-9_]*)\s*:\s*'([^']+)'/g)) {
      values.set(`${objectName}.${key}`, value);
    }
  };

  const authFile = path.join(ROOT, 'packages', 'auth', 'src', 'permissions.js');
  if (fs.existsSync(authFile)) record(stripComments(readSource(authFile)), 'PERMISSIONS');

  for (const service of fs.readdirSync(SERVICES_DIR)) {
    const modulesDir = path.join(SERVICES_DIR, service, 'src', 'modules');
    if (!fs.existsSync(modulesDir)) continue;

    for (const entry of fs.readdirSync(modulesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      for (const file of listFiles(path.join(modulesDir, entry.name), (f) => f.endsWith('.constants.js'))) {
        const src = stripComments(readSource(file));
        // Module-local grant maps are named the same way everywhere.
        for (const name of ['PERMISSION', 'PERMISSIONS']) record(src, name);
      }
    }
  }

  return values;
}

const PERMISSION_VALUES = loadPermissionValues();

const permissionLabel = (ref) => PERMISSION_VALUES.get(ref) || ref;

/** The guards and modifiers declared between the path and the handler. */
function describeMiddleware(args, aliases = new Map()) {
  const notes = [];

  for (const raw of args) {
    const arg = aliases.get(raw.trim()) || raw;

    const anyPermission = arg.match(/requireAnyPermission\s*\(([\s\S]*)\)/);
    if (anyPermission) {
      const values = [...anyPermission[1].matchAll(/([A-Za-z_$][\w$]*)\.([A-Z][A-Z0-9_]*)|'([^']+)'/g)]
        .map((x) => x[3] || permissionLabel(`${x[1]}.${x[2]}`));
      notes.push({ type: 'permission', value: [...new Set(values)].join(' | ') });
      continue;
    }

    const permission = arg.match(/requirePermission\s*\(\s*(?:([A-Za-z_$][\w$]*)\.([A-Z][A-Z0-9_]*)|'([^']+)')/);
    if (permission) {
      notes.push({
        type: 'permission',
        value: permission[3] || permissionLabel(`${permission[1]}.${permission[2]}`),
      });
      continue;
    }

    if (/^validate\s*\(/.test(arg)) { notes.push({ type: 'validate', value: arg.match(/validate\s*\(\s*([\w.]+)/)?.[1] || '' }); continue; }
    if (/rateLimit|limiter|throttle/i.test(arg)) { notes.push({ type: 'rateLimit', value: arg.replace(/\s+/g, ' ').slice(0, 40) }); continue; }
    if (/upload\.(single|array|fields)/.test(arg)) { notes.push({ type: 'upload', value: arg.replace(/\s+/g, ' ').slice(0, 40) }); continue; }
    if (/requireLevel|requireRole|requireSelf|requireActive|require[A-Z]/.test(arg)) {
      notes.push({ type: 'guard', value: arg.replace(/\s+/g, ' ').slice(0, 40) });
    }
  }

  return notes;
}

/**
 * Middleware applied to the whole file with `router.use(...)`.
 *
 * A file-wide `router.use(auth.requirePermission(...))` guards every route
 * below it just as an inline one does — `bet-history` and `marketing` are
 * written that way — so it has to be read, or those routes document as
 * ungated when they are not.
 */
function fileWideMiddleware(src, aliases) {
  const notes = [];
  const re = /router\s*\.\s*use\s*\(/g;
  let m;

  while ((m = re.exec(src))) {
    const { inner } = matchBracket(src, src.indexOf('(', m.index + m[0].length - 1));
    const args = splitArgs(inner);
    // `router.use('/path', sub)` mounts a sub-router; only the guard form counts.
    if (args[0] && /^['"]/.test(args[0])) continue;
    notes.push(...describeMiddleware(args, aliases));
  }

  return notes;
}

function parseRouteFile(filePath, audience, manifest, handlerIndex, serviceHelpers = new Map()) {
  const raw = readSource(filePath);
  const src = stripComments(raw);
  const localHandlers = collectHandlers(src);
  const routeLocals = new Map([...serviceHelpers, ...collectLocalFunctions(src)]);
  const aliases = permissionAliases(src);
  const shared = fileWideMiddleware(src, aliases);

  /**
   * The documented exemption from the loader's "an admin write must name a
   * grant" rule. A file that sets it acts only on the caller's own account, so
   * there is no other account a permission could protect — and it is a stated
   * sentence rather than an omission, which is the whole point of it.
   */
  const reviewed = src.match(/router\.authorizationReviewed\s*=\s*\n?\s*'((?:[^'\\]|\\.)*)'/)?.[1];
  if (reviewed) shared.push({ type: 'selfOnly', value: reviewed.replace(/\\'/g, "'") });
  const prefix = mountPrefix(audience, manifest.service, manifest.basePath);
  const routes = [];

  const re = new RegExp(`router\\s*\\.\\s*(${METHODS.join('|')})\\s*\\(`, 'g');
  let m;

  while ((m = re.exec(src))) {
    const open = src.indexOf('(', m.index + m[0].length - 1);
    const { inner } = matchBracket(src, open);
    const args = splitArgs(inner);
    if (!args.length) continue;

    const pathArg = args[0];
    const literal = pathArg.match(/^'([^']*)'$/) || pathArg.match(/^"([^"]*)"$/);
    const routePath = literal ? literal[1] : pathArg.replace(/\s+/g, ' ');

    const handlerExpr = args[args.length - 1];
    let body = null;
    let source = null;
    let name = '(inline)';

    const ref = handlerExpr.match(/^[a-zA-Z_$][\w$]*\.([a-zA-Z_$][\w$]*)$/);

    if (ref && handlerIndex.has(ref[1])) {
      const entry = handlerIndex.get(ref[1]);
      body = expandLocals(entry.expr, entry.locals);
      source = entry.file;
      name = ref[1];
    } else if (ref && localHandlers.has(ref[1])) {
      body = expandLocals(localHandlers.get(ref[1]), routeLocals);
      source = path.basename(filePath);
      name = ref[1];
    } else if (localHandlers.has(handlerExpr)) {
      body = expandLocals(localHandlers.get(handlerExpr), routeLocals);
      source = path.basename(filePath);
      name = handlerExpr;
    } else if (/[({]/.test(handlerExpr)) {
      // Declared at the route: `asyncHandler(async (req, res) => ...)`, or a
      // local wrapper invoked here such as `handle('getBalance')`.
      body = expandLocals(handlerExpr, routeLocals);
      source = path.basename(filePath);
      name = handlerExpr.split('(')[0] || '(inline)';
    }

    routes.push({
      service: manifest.service,
      module: manifest.name,
      audience,
      method: m[1].toUpperCase(),
      path: joinPath(prefix, routePath === '/' ? '' : routePath),
      routePath,
      handler: name,
      handlerSource: source,
      middleware: [...shared, ...describeMiddleware(args.slice(1, -1), aliases)],
      responses: extractResponses(body),
      thrown: extractThrownErrors(body),
      resolved: Boolean(body),
      file: repoPath(filePath),
    });
  }

  return routes;
}

// ── Error catalogues ───────────────────────────────────────────────────

function parseErrorCatalogue(filePath) {
  const src = stripComments(readSource(filePath));
  const at = src.indexOf('defineErrors(');
  if (at === -1) return null;

  const { inner } = matchBracket(src, src.indexOf('(', at));
  const args = splitArgs(inner);
  const namespace = args[0]?.match(/'([^']+)'/)?.[1];
  if (!namespace || !args[1]?.startsWith('{')) return null;

  const { inner: defs } = matchBracket(args[1], 0);
  const codes = splitArgs(defs).map((entry) => {
    const key = entry.match(/^([A-Z][A-Z0-9_]*)\s*:/)?.[1];
    if (!key) return null;
    const status = Number(entry.match(/status:\s*(\d+)/)?.[1]) || 400;
    const message = entry.match(/message:\s*'((?:[^'\\]|\\.)*)'/)?.[1]
      || entry.match(/message:\s*"((?:[^"\\]|\\.)*)"/)?.[1]
      || '';
    return { key, code: `${namespace}_${key}`, status, message: message.replace(/\\'/g, "'") };
  }).filter(Boolean);

  return { namespace, codes, file: repoPath(filePath) };
}

// ── Collection ─────────────────────────────────────────────────────────

/**
 * Responders that live beside a module rather than inside its controllers —
 * `renderStatement` in `statements/statementPdf.js`, `envelope.ok` in
 * `x-casino/envelope.js`. A handler that ends in one of these has no response
 * call of its own, so without this index it documents as answering nothing.
 *
 * Indexed per service because one module legitimately borrows another's:
 * `reports` renders its player sheet with `statements`' PDF writer.
 */
function collectServiceHelpers(modulesDir) {
  const helpers = new Map();

  for (const entry of fs.readdirSync(modulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.') || entry.name === '__tests__') continue;

    const moduleDir = path.join(modulesDir, entry.name);
    for (const file of listFiles(moduleDir, (f) => f !== 'index.js')) {
      const src = stripComments(readSource(file));
      // Only files that talk to `res` can be responders; skipping the rest
      // keeps unrelated names out of the fallback index.
      if (!/\bres\s*\.\s*(json|send|end|setHeader|status)|\.pipe\s*\(\s*res\s*\)/.test(src)) continue;

      // Under both keys: `renderStatement(...)` is called bare, `envelope.ok(...)`
      // through the module object it was required as.
      const base = path.basename(file, '.js');
      for (const [name, body] of collectLocalFunctions(src)) {
        if (!helpers.has(name)) helpers.set(name, body);
        if (!helpers.has(`${base}.${name}`)) helpers.set(`${base}.${name}`, body);
      }
    }
  }

  return helpers;
}

function collect() {
  const modules = [];
  const routes = [];
  const catalogues = [];

  for (const service of fs.readdirSync(SERVICES_DIR).sort()) {
    const modulesDir = path.join(SERVICES_DIR, service, 'src', 'modules');
    if (!fs.existsSync(modulesDir)) continue;

    const serviceHelpers = collectServiceHelpers(modulesDir);

    for (const entry of fs.readdirSync(modulesDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.') || entry.name === '__tests__') continue;

      const moduleDir = path.join(modulesDir, entry.name);
      const manifest = readManifest(moduleDir);
      if (!manifest) continue;
      manifest.service = manifest.service || service;
      modules.push(manifest);

      for (const errorFile of listFiles(moduleDir, (f) => f.endsWith('.errors.js'))) {
        const catalogue = parseErrorCatalogue(errorFile);
        if (catalogue) catalogues.push({ ...catalogue, service: manifest.service, module: manifest.name });
      }

      // Controllers first — route files point at them by name. Each handler
      // carries its file's local helpers, because that is where its response
      // call usually lives.
      const handlerIndex = new Map();
      for (const controllerFile of listFiles(path.join(moduleDir, 'controllers'))) {
        const src = stripComments(readSource(controllerFile));
        // File-local names shadow the service-wide fallback, so a module's own
        // `ok` helper is never confused with another module's.
        const locals = new Map([...serviceHelpers, ...collectLocalFunctions(src)]);
        for (const [name, expr] of collectHandlers(src)) {
          if (!handlerIndex.has(name)) handlerIndex.set(name, { expr, locals, file: path.basename(controllerFile) });
        }
      }

      for (const audience of AUDIENCES) {
        const routeFile = path.join(moduleDir, 'routes', `${audience}.routes.js`);
        if (!fs.existsSync(routeFile)) continue;
        routes.push(...parseRouteFile(routeFile, audience, manifest, handlerIndex, serviceHelpers));
      }
    }
  }

  routes.sort((a, b) =>
    a.service.localeCompare(b.service)
    || a.module.localeCompare(b.module)
    || AUDIENCES.indexOf(a.audience) - AUDIENCES.indexOf(b.audience)
    || a.path.localeCompare(b.path)
    || a.method.localeCompare(b.method));

  return { modules, routes, catalogues };
}

// ── Markdown ───────────────────────────────────────────────────────────

const AUDIENCE_LABEL = { public: 'public', user: 'player', admin: 'staff', internal: 'internal' };

function escapeCell(text) {
  return String(text).replace(/\|/g, '\\|');
}

function responseCell(route) {
  if (!route.responses.length) return route.resolved ? '—' : '`?` unresolved handler';

  return route.responses
    .map((r) => {
      if (r.kind === 'paginated') return '`200` `[…]` + `meta.pagination`';
      if (r.kind === 'noContent') return '`204` no body';
      if (r.kind === 'fail') return `\`${r.status || '4xx'}\` error envelope`;
      if (r.kind === 'header') return `**raw** ${escapeCell(`\`${r.shape}\``)}`;
      if (r.kind === 'raw') return `**raw** ${escapeCell(`\`${r.shape}\``)}`;
      return `\`${r.status}\` ${escapeCell(`\`${r.shape || 'null'}\``)}`;
    })
    .join(' · ');
}

function guardCell(route) {
  const parts = [`\`${AUDIENCE_LABEL[route.audience]}\``];
  for (const note of route.middleware) {
    if (note.type === 'permission') parts.push(`\`${note.value}\``);
    if (note.type === 'selfOnly') parts.push('self-only');
    if (note.type === 'upload') parts.push('upload');
    if (note.type === 'rateLimit') parts.push('rate-limited');
  }
  return [...new Set(parts)].join(' + ');
}

function renderMarkdown({ modules, routes, catalogues }) {
  const lines = [];
  const byService = new Map();
  for (const route of routes) {
    if (!byService.has(route.service)) byService.set(route.service, []);
    byService.get(route.service).push(route);
  }

  const unresolved = routes.filter((r) => !r.resolved).length;
  const nonEnvelope = routes.filter((r) => r.responses.some((x) => x.kind === 'raw' || x.kind === 'header'));

  lines.push('');
  lines.push('Every route the four services mount today, with the guard the loader');
  lines.push('attaches and the shape the handler answers with. Regenerate with');
  lines.push('`node tools/api-surface.js`.');
  lines.push('');
  lines.push('| | |');
  lines.push('| --- | ---: |');
  lines.push(`| Routes mounted | ${routes.length} |`);
  lines.push(`| Modules | ${modules.length} |`);
  lines.push(`| Answering outside the envelope | ${nonEnvelope.length} |`);
  if (unresolved) lines.push(`| Handlers not statically resolvable | ${unresolved} |`);
  lines.push('');
  lines.push('**Guard** is the audience the loader mounted the router under, plus anything');
  lines.push('the route adds. `public` carries no token. `player` and `staff` carry one.');
  lines.push('A grant string — `wallet:credit` — is checked against the caller\'s CURRENT');
  lines.push('database role on every request. `self-only` marks the loader\'s documented');
  lines.push('exemption: a staff write that takes no account id because it acts on the');
  lines.push('caller\'s own session, where a grant would protect nothing.');
  lines.push('');
  lines.push('**Response** reads as `status` `shape`. A shape in braces is an object literal');
  lines.push('in the source with those top-level keys; a bare name is the expression the');
  lines.push('handler passes, and its shape is whatever that function returns. `[…]` with');
  lines.push('`meta.pagination` is the list envelope from §6. **raw** means the route answers');
  lines.push('outside the platform envelope — §4 says which families do and why.');
  lines.push('');
  lines.push('More than one entry means the route answers differently depending on a');
  lines.push('condition in the handler, listed in source order — the first is the main path.');
  lines.push('A binary route shows its `Content-Type` and then the send. Failures are not');
  lines.push('listed per route: they are thrown from the service layer, so a module\'s whole');
  lines.push('error catalogue is reachable from every route in it, and the catalogues are at');
  lines.push('the end of this appendix.');
  lines.push('');

  for (const [service, serviceRoutes] of [...byService].sort()) {
    lines.push(`### ${service}-service — :${SERVICE_PORTS[service] ?? '?'} (${serviceRoutes.length} routes)`);
    lines.push('');

    const byModule = new Map();
    for (const route of serviceRoutes) {
      if (!byModule.has(route.module)) byModule.set(route.module, []);
      byModule.get(route.module).push(route);
    }

    for (const [module, moduleRoutes] of byModule) {
      lines.push(`#### \`${module}\``);
      lines.push('');
      lines.push('| Method | Path | Guard | Response |');
      lines.push('|---|---|---|---|');
      for (const route of moduleRoutes) {
        lines.push(`| \`${route.method}\` | \`${escapeCell(route.path)}\` | ${guardCell(route)} | ${responseCell(route)} |`);
      }
      lines.push('');
    }
  }

  lines.push('### Error catalogues');
  lines.push('');
  lines.push('Each module declares every failure it can produce. A code is stable; the');
  lines.push('message beside it is for a human and may be reworded. Errors are thrown from');
  lines.push('the service layer, so a code is reachable from any route in its module.');
  lines.push('');

  for (const catalogue of [...catalogues].sort((a, b) => a.namespace.localeCompare(b.namespace))) {
    lines.push(`#### \`${catalogue.namespace}\` — ${catalogue.service}/${catalogue.module} (${catalogue.codes.length})`);
    lines.push('');
    lines.push('| Status | Code | Message |');
    lines.push('|---:|---|---|');
    for (const code of catalogue.codes) {
      lines.push(`| \`${code.status}\` | \`${code.code}\` | ${escapeCell(code.message)} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Entry ──────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const surface = collect();

  if (args.includes('--json') || args.includes('--all') || args.length === 0) {
    writeKeepingEol(JSON_OUT, `${JSON.stringify(surface, null, 2)}\n`);
  }

  if (args.includes('--json')) {
    console.log(`Wrote ${path.relative(ROOT, JSON_OUT)} — ${surface.routes.length} routes`);
    return;
  }

  const doc = fs.readFileSync(DOC, 'utf8');
  const begin = doc.indexOf(BEGIN);
  const end = doc.indexOf(END);

  if (begin === -1 || end === -1) {
    console.error(`docs/API-ROUTES.md has no "${BEGIN}" / "${END}" block — add one first.`);
    process.exit(1);
  }

  const next = `${doc.slice(0, begin + BEGIN.length)}\n${renderMarkdown(surface)}\n${doc.slice(end)}`;

  if (args.includes('--check')) {
    /**
     * Compared on CONTENT, not bytes.
     *
     * `renderMarkdown` joins on `\n`; the working tree is CRLF wherever this
     * is cloned with `core.autocrlf = true`, which is how it is cloned. A
     * `!==` here therefore failed on every Windows checkout and reported the
     * docs stale when they were identical — see tools/lib/eol.js.
     */
    if (!sameContent(next, doc)) {
      console.error('docs/API-ROUTES.md is out of date — run: node tools/api-surface.js');
      process.exit(1);
    }
    console.log('docs/API-ROUTES.md is up to date');
    return;
  }

  // In the ending the file already uses, so regenerating does not rewrite
  // every line of the working copy.
  writeKeepingEol(DOC, next);
  console.log(
    `Wrote docs/API-ROUTES.md — ${surface.routes.length} routes, `
    + `${surface.modules.length} modules, ${surface.catalogues.length} error catalogues`
  );
}

if (require.main === module) main();

module.exports = { collect, renderMarkdown, stripComments, splitArgs, describePayload };
