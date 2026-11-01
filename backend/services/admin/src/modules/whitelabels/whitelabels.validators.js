'use strict';

const { z, featureCatalogue } = require('@ibitplay/common');
const { PALETTE_KEYS } = require('../whitelabel-link/whitelabelLink.service');
// The copy validates the same shape (its link PUT /plan), so the two sides cannot drift.
const { planSchema } = require('../whitelabel-link/routes/public.routes');

const id = z.coerce.number().int().positive();
const params = { params: z.object({ id }).strict() };

const paging = {
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
};

/** A folder, pm2 prefix and database name: lower-case, starts with a letter. */
const slug = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9-]{2,28}[a-z0-9]$/, 'slug: 4–30 lower-case letters, digits and -, starting with a letter');

const domain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'must be a domain name like play.example.com');

// Shown on pages and in <title>: no markup characters.
const text = (max) => z.string().trim().max(max).refine((v) => !/[<>\u0000-\u001f]/.test(v), 'contains a character that is not allowed');

// bcrypt reads 72 bytes at most.
const password = z.string().min(8, 'password must be at least 8 characters').max(72, 'password must be at most 72 characters');

const palette = z
  .object(Object.fromEntries(PALETTE_KEYS.map((k) => [k, z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be #RRGGBB')])))
  .strict();

const image = z.object({ type: z.enum(['image/png', 'image/webp', 'image/svg+xml']), data: z.string().max(360_000) }).strict();
// A poster is a photo: PNG, JPEG or WebP, at most 600 KB (as base64 it stays inside the 1 MB body).
const poster = z.object({ type: z.enum(['image/png', 'image/jpeg', 'image/webp']), data: z.string().max(820_000) }).strict();

const amount = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, 'must be a positive amount with at most 2 decimal places')
  .refine((v) => Number.parseFloat(v) > 0, 'amount must be greater than zero');

const create = {
  body: z
    .object({
      name: text(60).pipe(z.string().min(2, 'name must be at least 2 characters')),
      slug,
      title: text(70).optional(),
      description: text(300).optional(),
      siteDomain: domain,
      adminDomain: domain,
      apiDomain: domain,
      template: z.enum(featureCatalogue.TEMPLATE_KEYS),
      // Required: the Super Admin chooses the products (at least one) and features.
      plan: planSchema(),
      palette: palette.nullable().optional(),
      // base64 of the file; checked byte by byte in the service (branding.rules imageProblem).
      logo: image.optional(),
      // The square mark: favicon and small icons. Absent = the logo is used.
      icon: image.optional(),
      // The home-page poster (desktop, phone). Absent = the copy's own logo on its brand colours.
      poster: poster.optional(),
      posterMobile: poster.optional(),
      companyRoleName: text(40).pipe(z.string().min(2, 'hierarchy name must be at least 2 characters')),
      companyName: text(80).pipe(z.string().min(2, 'company name must be at least 2 characters')),
      companyEmail: z.string().trim().toLowerCase().email().max(190),
      companyPassword: password,
    })
    .strict(),
};

module.exports = {
  list: {
    query: z
      .object({
        ...paging,
        search: z.string().trim().max(80).optional(),
        status: z.enum(['queued', 'creating', 'live', 'failed', 'deleting', 'deleted']).optional(),
      })
      .strict(),
  },
  create,
  // Routes with no body add `noBody()` beside this.
  byId: params,
  transfer: {
    ...params,
    body: z.object({ amount, note: text(200).optional(), transactionPassword: z.string().min(1).max(200) }).strict(),
  },
  password: { ...params, body: z.object({ password }).strict() },
  maintenance: { ...params, body: z.object({ on: z.boolean() }).strict() },
  palette: { ...params, body: z.object({ palette: palette.nullable() }).strict() },
  plan: { ...params, body: z.object({ plan: planSchema() }).strict() },
  poster: {
    ...params,
    body: z
      .object({ desktop: poster.optional(), mobile: poster.optional() })
      .strict()
      .refine((b) => b.desktop || b.mobile, 'send a desktop poster, a phone poster or both'),
  },
  posterImage: { params: z.object({ id, which: z.enum(['poster', 'poster_mobile']) }).strict() },
  branding: {
    ...params,
    body: z
      .object({ logo: image.optional(), icon: image.optional() })
      .strict()
      .refine((b) => b.logo || b.icon, 'send a logo, an icon or both'),
  },
  remove: {
    ...params,
    body: z.object({ confirmName: z.string().trim().max(60), acknowledgeBalances: z.boolean().optional() }).strict(),
  },
};
