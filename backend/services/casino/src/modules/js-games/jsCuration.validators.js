'use strict';

const { z } = require('@ibitplay/common');

const { SCOPE_VALUES, COLLECTION_SLUGS, MAX_LIST_SIZE } = require('./jsCuration.constants');

const gameUid = z.string().trim().min(1).max(190);

/**
 * `key` is a vendor name or a game type, both of which come from the provider
 * and are free text. Length-capped to the column and otherwise taken as given —
 * it reaches the database as a bound parameter, and rejecting characters a
 * provider legitimately uses (`Evolution Gaming`, `Play'n GO`) would make those
 * vendors uncurateable.
 */
const curationKey = z.string().trim().min(1).max(190);

const scopeParam = z.enum(SCOPE_VALUES);

const readCuration = {
  params: z.object({ scope: scopeParam, key: curationKey }).strict(),
};

const writeCuration = {
  params: z.object({ scope: scopeParam, key: curationKey }).strict(),
  body: z
    .object({
      /**
       * The WHOLE list, in order. Not a patch — see `JsCurationService.write`.
       * An empty array is valid and means "curate this list to nothing", which
       * is different from never having curated it.
       */
      gameUids: z.array(gameUid).max(MAX_LIST_SIZE),
    })
    .strict(),
};

const readCollection = {
  params: z.object({ collection: z.enum(COLLECTION_SLUGS) }).strict(),
  query: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      per_page: z.coerce.number().int().min(1).max(100).default(50),
    })
    .strict(),
};

const searchCatalogue = {
  query: z
    .object({
      q: z.string().trim().max(120).default(''),
      vendor: z.string().trim().max(190).optional(),
      type: z.string().trim().max(190).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(30),
      /** Operators need to find a game they have switched off, to switch it back. */
      include_inactive: z.coerce.boolean().default(false),
    })
    .strict(),
};

const updateIcon = {
  params: z.object({ gameUid }).strict(),
  body: z.object({ icon: z.string().trim().url().max(500) }).strict(),
};

module.exports = { readCuration, writeCuration, readCollection, searchCatalogue, updateIcon };
