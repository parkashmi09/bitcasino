'use strict';

const { z } = require('@ibitplay/common');

const { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } = require('./blogs.constants');

/**
 * Blog validators.
 *
 * ── EVERY FIELD BELOW WAS UNCHECKED ──────────────────────────────────────
 *
 * `createBlog` destructured the body with defaults and tested exactly two
 * things: that `title` and `description` were truthy, and that `date` parsed.
 * Length, type, and what `description` contains were never considered — and
 * `description` is rendered as the body of a page.
 */

const id = z.coerce.number().int().positive();

/**
 * Slugs are generated, never accepted.
 *
 * This shape is for READING one. A client cannot choose a post's address:
 * legacy built it from the title, and letting a caller supply it would let them
 * claim a path that collides with a route.
 */
const slug = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'A slug is lowercase letters, digits and single dashes');

const title = z.string().trim().min(1).max(512);
const subheading = z.string().trim().max(1000);
const description = z.string().trim().min(1).max(200_000);
const author = z.string().trim().min(1).max(255);
const category = z.string().trim().min(1).max(128);

/**
 * `date` is the DISPLAY date — what the post says it was written on.
 *
 * Separate from `published_at`, which is when it actually went live. Legacy had
 * only this one and defaulted it to now, so the two were conflated.
 */
const displayDate = z.coerce.date();

const list = {
  query: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
      category: category.optional(),
      /** Free-text over title and subheading. Not a legacy capability. */
      search: z.string().trim().min(1).max(200).optional(),
    })
    .strict(),
};

/** @legacy GET /by-slug?slug=… */
const bySlug = { params: z.object({ slug }).strict() };

/** @legacy GET /by-id?id=5 */
const byId = { params: z.object({ id }).strict() };

/** @legacy GET /by-category?category=news */
const byCategory = {
  params: z.object({ category }).strict(),
  query: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
    })
    .strict(),
};

/**
 * @legacy POST /createBlog
 *
 * multipart/form-data, so every value arrives as a string — hence `coerce` on
 * the date and the boolean below.
 */
const create = {
  body: z
    .object({
      title,
      description,
      subheading: subheading.optional(),
      author: author.optional(),
      category: category.optional(),
      date: displayDate.optional(),
      /**
       * Publishing is now a choice. Legacy had none: the INSERT was the
       * publish. Default false so a half-written post is not live the moment
       * it is saved.
       */
      isPublished: z.coerce.boolean().default(false),
    })
    .strict(),
};

/**
 * @legacy POST /updateBlog?id=…
 *
 * Legacy read the id from `req.query.id || req.body.id` — either, whichever
 * turned up. It is a path parameter here, so there is one place it can be.
 *
 * `.partial()` on the content fields, because an update names only what it
 * changes. At least one is required — an empty update was a 500 in legacy,
 * thrown from the repository.
 */
const update = {
  params: z.object({ id }).strict(),
  body: z
    .object({
      title: title.optional(),
      description: description.optional(),
      subheading: subheading.optional(),
      author: author.optional(),
      category: category.optional(),
      date: displayDate.optional(),
      isPublished: z.coerce.boolean().optional(),
      /**
       * Regenerate the address from the new title.
       *
       * Legacy did this UNCONDITIONALLY whenever the title changed — every
       * typo fix in a headline silently broke the post's URL and every link to
       * it. Opt-in here, and the old slug is what a reader's bookmark keeps
       * working against.
       */
      regenerateSlug: z.coerce.boolean().default(false),
    })
    .strict()
    .refine((body) => Object.keys(body).some((key) => key !== 'regenerateSlug'), {
      message: 'Provide at least one field to change',
    }),
};

/** @legacy POST /deleteBlog — body: { slug } */
const removeBySlug = { params: z.object({ slug }).strict() };

/** @legacy POST /deleteBlogById?id=5 */
const removeById = { params: z.object({ id }).strict() };

/**
 * `POST /uploadImage` HAS NO VALIDATOR BECAUSE IT HAS NO ROUTE.
 *
 * It accepted a file and returned its public URL — a standalone, unauthenticated
 * write of arbitrary bytes to a statically-served directory, with the filename
 * extension taken from `file.originalname`. Nothing tied the upload to a post,
 * so nothing ever cleaned one up.
 *
 * An image belongs to a post here: it is a field on create and update, stored
 * in the row, and served by `GET /blogs/:id/image`. There is no way to put a
 * file on the server that no row points at.
 */

module.exports = { list, bySlug, byId, byCategory, create, update, removeBySlug, removeById };
