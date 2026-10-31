'use strict';

const { z } = require('@ibitplay/common');

/**
 * The audit row every service posts through `withActivity`.
 *
 * Loose on the optional context, strict on who and what: `action` and `staffId`
 * are the two fields an investigation always starts from, so a row missing
 * either is rejected rather than stored as an unattributable entry.
 */
const recordActivity = {
  body: z.object({
    action: z.string().trim().min(1).max(100),
    staffId: z.coerce.number().int().positive(),
    executiveId: z.coerce.number().int().positive().nullable().optional(),

    service: z.string().trim().max(50).optional(),
    method: z.string().trim().max(10).optional(),
    path: z.string().trim().max(500).optional(),
    statusCode: z.coerce.number().int().optional(),
    outcome: z.enum(['success', 'rejected']).default('success'),

    targetType: z.string().trim().max(50).nullable().optional(),
    // Target ids are heterogeneous across domains (numeric bet ids, text match
    // ids), so this is carried as text rather than coerced.
    targetId: z.coerce.string().trim().max(128).nullable().optional(),
    details: z.record(z.any()).nullable().optional(),

    ip: z.string().trim().max(64).nullable().optional(),
    userAgent: z.string().trim().max(500).nullable().optional(),
    requestId: z.string().trim().max(64).nullable().optional(),
    errorMessage: z.string().trim().max(1000).nullable().optional(),
  }),
};

/**
 * Reading the trail.
 *
 * Every filter the Activity Log screen offers is accepted HERE, on the server.
 * The screen used to apply its search and status filters to the fifty rows it
 * happened to be holding, which silently means "search this page" — a hit on
 * row 3,000 could not be found, and the entry count above the table described
 * a different set of rows than the table showed.
 *
 * An EMPTY filter is "no filter", not a bad request. A `status=` with nothing
 * after it is what a dropdown reading "All" naturally sends, and a bare
 * `z.enum().optional()` answers that with a 422 that blanks the whole screen —
 * so the empty string is folded to `undefined` before the enum sees it.
 */
const blankToUndefined = (schema) =>
  z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), schema);

const listActivity = {
  query: z.object({
    staffId: z.coerce.number().int().positive().optional(),
    action: z.string().trim().max(100).optional(),
    status: blankToUndefined(z.enum(['success', 'failed']).optional()),
    targetType: z.string().trim().max(50).optional(),
    targetId: z.string().trim().max(128).optional(),
    /** Free text over actor name, target id and IP. */
    q: blankToUndefined(z.string().trim().max(200).optional()),
    from: blankToUndefined(z.coerce.date().optional()),
    to: blankToUndefined(z.coerce.date().optional()),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }),
};

module.exports = { recordActivity, listActivity };
