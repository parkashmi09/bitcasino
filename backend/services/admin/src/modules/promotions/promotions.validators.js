'use strict';

const { z } = require('@ibitplay/common');

const { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, SEGMENTS, PROMO_STATUSES, SIDEBAR_ICONS } = require('./promotions.constants');
const {
  qualifyingGames,
  sportEvents,
  tags,
  leaderboardField,
  tournamentPanelField,
  viewAllHref,
} = require('./promotions.schemas');

/**
 * A multipart boolean. `formBoolean` is `Boolean(value)`, so the string `"false"` a
 * FormData body carries came out TRUE (the same bug blogs.validators.js had). Real booleans pass;
 * the strings `true/false/1/0/on/off` are read as such.
 */
const formBoolean = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const v = value.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'on') return true;
  if (v === 'false' || v === '0' || v === 'off' || v === '') return false;
  return value;
}, z.boolean());

const id = z.coerce.number().int().positive();

const segment = z.enum(SEGMENTS);

const slug = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'A slug is lowercase letters, digits and single dashes');

const title = z.string().trim().min(1).max(512);
const summary = z.string().trim().max(2000);
const description = z.string().trim().min(1).max(200_000);
const termsHtml = z.string().trim().max(200_000).optional().nullable();
const imageAlt = z.string().trim().max(512);
const promoStatus = z.enum(PROMO_STATUSES);
const endsAt = z.coerce.date().optional().nullable();
const sidebarIcon = z
  .string()
  .trim()
  .max(128)
  .optional()
  .refine((v) => !v || SIDEBAR_ICONS.includes(v), 'Unknown sidebar icon');
const sidebarLabel = z.string().trim().max(512);
const sidebarCounter = z.string().trim().max(32);
const sidebarSort = z.coerce.number().int().min(0).max(9999).default(0);

const sidebarList = { query: z.object({}).strict() };

const list = {
  query: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
      segment: segment.optional(),
      search: z.string().trim().min(1).max(200).optional(),
    })
    .strict(),
};

const bySlug = { params: z.object({ segment, slug }).strict() };

const byId = { params: z.object({ id }).strict() };

const create = {
  body: z
    .object({
      segment,
      title,
      description,
      summary: summary.optional(),
      termsHtml: termsHtml.optional(),
      imageAlt: imageAlt.optional(),
      featured: formBoolean.default(false),
      promoStatus: promoStatus.default('live'),
      endsAt: endsAt.optional(),
      isPublished: formBoolean.default(false),
      viewAllHref: viewAllHref.optional(),
      qualifyingGames: qualifyingGames.optional(),
      sportEvents: sportEvents.optional(),
      tags: tags.optional(),
      leaderboard: leaderboardField.optional(),
      tournamentPanel: tournamentPanelField.optional(),
      showInSidebar: formBoolean.default(false),
      sidebarLabel: sidebarLabel.optional(),
      sidebarIcon: sidebarIcon.optional(),
      sidebarCounter: sidebarCounter.optional(),
      sidebarSort: sidebarSort.optional(),
    })
    .strict(),
};

const update = {
  params: z.object({ id }).strict(),
  body: z
    .object({
      segment: segment.optional(),
      title: title.optional(),
      description: description.optional(),
      termsHtml: termsHtml.optional(),
      summary: summary.optional(),
      imageAlt: imageAlt.optional(),
      featured: formBoolean.optional(),
      promoStatus: promoStatus.optional(),
      endsAt: endsAt.optional(),
      isPublished: formBoolean.optional(),
      viewAllHref: viewAllHref.optional(),
      qualifyingGames: qualifyingGames.optional(),
      sportEvents: sportEvents.optional(),
      tags: tags.optional(),
      leaderboard: leaderboardField.optional(),
      tournamentPanel: tournamentPanelField.optional(),
      showInSidebar: formBoolean.optional(),
      sidebarLabel: sidebarLabel.optional(),
      sidebarIcon: sidebarIcon.optional(),
      sidebarCounter: sidebarCounter.optional(),
      sidebarSort: sidebarSort.optional(),
      regenerateSlug: formBoolean.default(false),
    })
    .strict()
    .refine((body) => Object.keys(body).some((key) => key !== 'regenerateSlug'), {
      message: 'Provide at least one field to change',
    }),
};

const removeBySlug = { params: z.object({ segment, slug }).strict() };

const removeById = { params: z.object({ id }).strict() };

module.exports = { list, sidebarList, bySlug, byId, create, update, removeBySlug, removeById };
