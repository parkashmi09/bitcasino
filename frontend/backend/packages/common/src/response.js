'use strict';

/**
 * One response envelope for the whole platform, so a client never has to guess
 * where the payload is:
 *
 *   success -> { success: true,  data: <payload>, meta?: {...} }
 *   failure -> { success: false, error: { code, message, details? } }
 */

function ok(res, data = null, meta) {
  return res.status(200).json({ success: true, data, ...(meta ? { meta } : {}) });
}

function created(res, data = null, meta) {
  return res.status(201).json({ success: true, data, ...(meta ? { meta } : {}) });
}

function accepted(res, data = null, meta) {
  return res.status(202).json({ success: true, data, ...(meta ? { meta } : {}) });
}

function noContent(res) {
  return res.status(204).end();
}

/**
 * Paginated list response.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS ACCEPTS TWO SHAPES BECAUSE IT USED TO ACCEPT ONE, AND MOST CALLERS
 * PASSED THE OTHER. THAT IS MY BUG.
 *
 * The signature was `(res, {rows, count}, {page, limit})` — Sequelize's
 * `findAndCountAll` output, passed through. Nearly every call site in the four
 * services instead passes the ROWS ARRAY plus a `total` in the pagination
 * object, which reads better at the call site:
 *
 *     response.paginated(res, result.rows, { page, limit, total: result.total })
 *
 * Destructuring `{ rows, count }` out of an array yields `undefined` for both,
 * and the defaults below turned that into a 200 with `data: []` and `total: 0`.
 * So every list endpoint written that way answered EMPTY — no error, no log
 * line, just a page of nothing where the rows were. Two rows in, zero rows out.
 *
 * Both shapes are honoured now rather than rewriting 50-odd call sites into a
 * signature that fewer of them preferred:
 *
 *     paginated(res, [row, row], { page, limit, total })   // array + total
 *     paginated(res, { rows, count }, { page, limit })     // findAndCountAll
 *
 * `total` in the pagination object wins when both are present, because a caller
 * who passes it has said what the total is.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * @param {any[]|{rows: any[], count: number}} result Rows, or findAndCountAll output.
 * @param {{page: number, limit: number, total?: number}} pagination
 */
function paginated(res, result, pagination, extraMeta = {}) {
  const rows = Array.isArray(result) ? result : result?.rows ?? [];
  const { page = 1, limit = 20 } = pagination || {};

  /**
   * The count, in the order a caller most likely meant it: an explicit `total`,
   * then `findAndCountAll`'s `count`, then the rows actually in hand.
   *
   * That last fallback matters — a caller who passes an array and forgets
   * `total` gets a total matching what they can see, not a zero contradicting
   * the rows in the same response.
   */
  const count = Number(
    pagination?.total ?? (Array.isArray(result) ? rows.length : result?.count ?? rows.length)
  );

  return res.status(200).json({
    success: true,
    data: rows,
    meta: {
      pagination: {
        page,
        limit,
        total: count,
        totalPages: limit > 0 ? Math.ceil(count / limit) : 0,
        hasNext: page * limit < count,
        hasPrev: page > 1,
      },
      ...extraMeta,
    },
  });
}

function fail(res, status, code, message, details) {
  return res.status(status).json({
    success: false,
    error: { code, message, ...(details ? { details } : {}) },
  });
}

module.exports = { ok, created, accepted, noContent, paginated, fail };
