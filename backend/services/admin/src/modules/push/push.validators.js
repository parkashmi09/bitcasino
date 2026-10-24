'use strict';

const { z } = require('@ibitplay/common');

const { TAG_RELATIONS, MAX_BUTTONS } = require('../notifications/providers/onesignal');
const { TEMPLATE_KINDS } = require('./push.constants');

const id = z.coerce.number().int().positive();

/** A click target: absolute http(s) or a site path ('/vip', '#transactions'). */
const clickUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((s) => /^https?:\/\//i.test(s) || s.startsWith('/') || s.startsWith('#'), 'must be https://… or a site path like /vip');

const mediaUrl = z.string().trim().url().max(2000);

const button = z
  .object({
    id: z.string().trim().regex(/^[a-zA-Z0-9_-]{1,32}$/, 'button id: letters, digits, _ or -'),
    text: z.string().trim().min(1).max(40),
    url: clickUrl.nullish(),
    icon: mediaUrl.nullish(),
  })
  .strict();

const tagFilter = z
  .object({
    tag: z.string().trim().regex(/^[a-zA-Z0-9_]{1,32}$/, 'tag: letters, digits or _'),
    relation: z.enum(TAG_RELATIONS),
    value: z.string().trim().max(100).nullish(),
  })
  .strict();

const audience = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }).strict(),
  z.object({ kind: z.literal('players'), userIds: z.array(id).min(1).max(10_000) }).strict(),
  z.object({ kind: z.literal('segment'), segments: z.array(z.string().trim().min(1).max(100)).min(1).max(5) }).strict(),
  z
    .object({ kind: z.literal('filters'), filters: z.array(tagFilter).min(1).max(10), match: z.enum(['all', 'any']).default('all') })
    .strict(),
]);

/** What a push says and looks like — shared by campaigns, preview and test-send. */
const content = {
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(500),
  imageUrl: mediaUrl.nullish(),
  iconUrl: mediaUrl.nullish(),
  badgeUrl: mediaUrl.nullish(),
  url: clickUrl.nullish(),
  buttons: z.array(button).max(MAX_BUTTONS).default([]),
  data: z.record(z.union([z.string().max(500), z.number(), z.boolean()])).nullish(),
  priority: z.enum(['normal', 'high']).default('normal'),
  ttlSeconds: z.number().int().min(0).max(2_419_200).nullish(),
  topic: z.string().trim().regex(/^[a-zA-Z0-9_-]{1,64}$/, 'topic: letters, digits, _ or -').nullish(),
};

const campaignBody = z
  .object({
    name: z.string().trim().max(120).nullish(),
    ...content,
    audience,
    inbox: z.boolean().default(true),
    sendAt: z.coerce.date().nullish(),
  })
  .strict();

const campaignParam = { params: z.object({ id }) };

const list = {
  query: z.object({
    status: z.enum(['draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
  }).strict(),
};

const create = { body: campaignBody };
const update = { params: campaignParam.params, body: campaignBody };
const preview = { body: campaignBody.extend({ probe: z.boolean().default(false) }) };
const schedule = { params: campaignParam.params, body: z.object({ sendAt: z.coerce.date() }).strict() };
const testCampaign = { params: campaignParam.params, body: z.object({ userId: id }).strict() };
const testSend = { body: z.object({ userId: id, ...content }).strict() };

const kinds = TEMPLATE_KINDS.map((t) => t.kind);
const templateParam = { params: z.object({ kind: z.enum(kinds) }) };
const putTemplate = {
  params: templateParam.params,
  body: z
    .object({
      enabled: z.boolean(),
      title: z.string().trim().min(1).max(120),
      body: z.string().trim().min(1).max(500),
      imageUrl: mediaUrl.nullish(),
      url: clickUrl.nullish(),
    })
    .strict(),
};

const putSettings = {
  body: z
    .object({
      prompt: z
        .object({
          enabled: z.boolean(),
          title: z.string().trim().min(1).max(80),
          text: z.string().trim().min(1).max(300),
          allowLabel: z.string().trim().min(1).max(24),
          laterLabel: z.string().trim().min(1).max(24),
          trigger: z.enum(['after_login', 'after_first_deposit']),
          delaySeconds: z.number().int().min(0).max(3600),
          cooldownDays: z.number().int().min(1).max(365),
        })
        .strict()
        .optional(),
      publicOrigin: z
        .string()
        .trim()
        .max(200)
        .refine((s) => s === '' || /^https?:\/\/[^/\s]+$/i.test(s.replace(/\/+$/, '')), 'an origin like https://example.com (no path)')
        .optional(),
      allSegment: z.string().trim().min(1).max(100).optional(),
      defaultIconUrl: z.union([z.literal(''), mediaUrl]).optional(),
    })
    .strict(),
};

const imageParam = { params: z.object({ file: z.string().regex(/^\d{1,18}-[0-9a-f]{12}\.(png|jpg|webp|gif)$/) }) };

module.exports = {
  audience,
  campaignBody,
  campaignParam,
  list,
  create,
  update,
  preview,
  schedule,
  testCampaign,
  testSend,
  templateParam,
  putTemplate,
  putSettings,
  imageParam,
};
