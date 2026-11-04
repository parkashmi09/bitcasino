'use strict';

const { z } = require('@ibitplay/common');

/** No `<`, `>` or control characters (newline and tab allowed only where `multiline`). */
const BAD = /[<>\u0000-\u001f\u007f]/;
const BAD_MULTILINE = /[<>\u0000-\u0008\u000b-\u001f\u007f]/;

const text = (max, multiline = false) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !(multiline ? BAD_MULTILINE : BAD).test(v), 'No < > or control characters')
    .default('');

/** http(s) URL or a site-relative path (`/terms`, not `//evil.com`); empty = unset. */
const link = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || (/^\/(?!\/)/.test(v) && !BAD.test(v)) || /^https?:\/\/[^\s<>"]+$/i.test(v), 'Must be an http(s) link or start with /')
  .default('');

const email = z
  .string()
  .trim()
  .max(200)
  .refine((v) => v === '' || z.string().email().safeParse(v).success, 'Not an email address')
  .default('');

const NETWORKS = ['facebook', 'x', 'instagram', 'youtube', 'tiktok', 'telegram', 'discord', 'whatsapp', 'forum', 'other'];

const SECTIONS = {
  footer: z
    .object({
      columns: z
        .array(z.object({ title: text(60), links: z.array(z.object({ label: text(80), href: link }).strict()).max(20).default([]) }).strict())
        .max(8)
        .default([]),
    })
    .strict(),
  social: z.object({ links: z.array(z.object({ network: z.enum(NETWORKS), href: link }).strict()).max(20).default([]) }).strict(),
  support: z.object({ email, liveChatUrl: link, helpCenterUrl: link }).strict(),
  legal: z
    .object({ companyNote: text(1000, true), copyright: text(200), licenseText: text(1000, true), licenseUrl: link, ageNotice: text(300, true) })
    .strict(),
  home: z.object({ heroTitle: text(120), heroSubtitle: text(300), registerCta: text(40) }).strict(),
  pages: z
    .object({
      items: z
        .array(
          z
            .object({
              slug: z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lowercase-words-with-dashes').max(64),
              title: text(120),
              body: text(50_000, true),
            })
            .strict()
        )
        .max(30)
        .default([])
        .refine((items) => new Set(items.map((i) => i.slug)).size === items.length, 'Each page needs its own slug'),
    })
    .strict(),
  vip: z
    .object({
      title: text(120),
      subtitle: text(300),
      benefits: z.array(z.object({ title: text(80), text: text(500, true) }).strict()).max(20).default([]),
      faq: z.array(z.object({ q: text(200), a: text(2000, true) }).strict()).max(30).default([]),
    })
    .strict(),
};

const KEYS = Object.keys(SECTIONS);

const keyParams = z.object({ key: z.enum(KEYS) }).strict();
const emptyQuery = z.preprocess((v) => v ?? {}, z.object({}).strict());

module.exports = { SECTIONS, KEYS, NETWORKS, keyParams, emptyQuery };
