'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('GAMES', {
  NOT_FOUND: { status: 404, message: 'Game not found' },

  UNKNOWN_COLLECTION: {
    status: 404,
    message: 'No such lobby collection',
  },

  PROVIDER_NOT_FOUND: { status: 404, message: 'No games found for this provider' },

  COLLECTION_TOO_LARGE: {
    status: 422,
    // A curated list is loaded whole by the lobby. An unbounded one is a way to
    // make every lobby request slow from a single admin action.
    message: 'A collection may not hold more than 5000 games',
  },

  UNKNOWN_GAMES: {
    status: 422,
    // Legacy stored whatever uuids it was given and silently dropped the ones
    // that did not join, so a collection could look saved and come back short
    // with nothing to say why.
    message: 'Some of the supplied game uuids do not exist',
  },

  LOGO_URL_FAILED: {
    status: 422,
    message: 'Could not fetch an image from that URL (https only, public host, PNG/JPEG/WebP up to 1 MB)',
  },

  IMAGE_URL_INVALID: {
    status: 422,
    // The image is rendered in every player's lobby. An unchecked URL here is
    // stored content injection with an admin-shaped delivery mechanism.
    message: 'Game image must be an absolute http(s) URL',
  },

  TOO_MANY_FAVOURITES: {
    status: 422,
    // A favourite reference is not checked against a catalogue (migration 038
    // says why), so the cap is what stops this table becoming free per-account
    // storage. 500 is far past anything a real player reaches.
    message: 'You have reached the maximum of 500 favourite games',
  },

  VENDOR_REQUIRED: { status: 422, message: 'A vendor is required' },

  // ── The site admin's provider switch and logos (migration 067) ─────────

  PROVIDER_DISABLED: {
    status: 403,
    // A launch of a game whose provider the site admin switched off. The lobby
    // no longer lists it; this is what a stale tile, a bookmark or a direct
    // POST gets instead of an upstream session.
    message: 'This game provider is not available right now',
  },

  LOGO_NOT_FOUND: { status: 404, message: 'No logo for this provider' },
  ARTWORK_NOT_FOUND: { status: 404, message: 'No artwork by this name' },

  // What `@ibitplay/common` imageUpload.inspect needs, in this namespace.
  NO_FILE: { status: 400, message: 'No image was uploaded' },
  NOT_AN_IMAGE: { status: 415, message: 'That file is not a PNG, JPEG or WebP image' },
  FORMAT_REFUSED: { status: 415, message: 'That image format is not accepted here' },
  TOO_LARGE: { status: 413, message: 'A provider logo may not exceed 1 MB' },
  TOO_SMALL: { status: 400, message: 'That upload is too small to be an image — it may have been truncated' },

  TYPE_REQUIRED: { status: 422, message: 'A game type is required' },
});
