'use strict';

const { z } = require('@ibitplay/common');

const { TEXT_LIMITS, MAX_KEYWORDS, MAX_KEYWORD_LENGTH, BAD_TEXT } = require('./branding.rules');

/** `<64 hex>.<png|webp|svg>` and nothing else: no path, no other extension, no case games. */
const assetParams = z.object({ file: z.string().regex(/^[0-9a-f]{64}\.(png|webp|svg)$/, 'not a branding image name') }).strict();

/** The reads take no query string at all. */
const emptyQuery = z.preprocess((v) => v ?? {}, z.object({}).strict());

/** The slots the Super Admin sets: the header logo and the square icon. */
const siteSlot = z.object({ slot: z.enum(['logo', 'mark']) }).strict();

/** One text field: the owner panel's limits (branding.rules.js), no `<`, `>` or control characters. */
const text = (max) => z.string().trim().max(max).refine((v) => !BAD_TEXT.test(v), 'No < > or control characters').default('');

/** The Super Admin's site name and page metadata (`PUT admin/branding/meta`); empty = unset. */
const siteMeta = z
  .object({
    siteName: text(TEXT_LIMITS.siteName),
    title: text(TEXT_LIMITS.title),
    titleTemplate: text(TEXT_LIMITS.titleTemplate).refine((v) => !v || v.split('%s').length === 2, 'Must contain %s exactly once'),
    description: text(TEXT_LIMITS.description),
    keywords: z.array(text(MAX_KEYWORD_LENGTH)).max(MAX_KEYWORDS).default([]),
    ogTitle: text(TEXT_LIMITS.ogTitle),
    ogDescription: text(TEXT_LIMITS.ogDescription),
    themeColor: z.string().trim().regex(/^(#[0-9a-fA-F]{6})?$/, 'A colour like #24EE89').default(''),
  })
  .strict();

module.exports = { assetParams, emptyQuery, siteSlot, siteMeta };
