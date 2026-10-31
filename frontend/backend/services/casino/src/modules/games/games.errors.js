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

  IMAGE_URL_INVALID: {
    status: 422,
    // The image is rendered in every player's lobby. An unchecked URL here is
    // stored content injection with an admin-shaped delivery mechanism.
    message: 'Game image must be an absolute http(s) URL',
  },

  VENDOR_REQUIRED: { status: 422, message: 'A vendor is required' },
  TYPE_REQUIRED: { status: 422, message: 'A game type is required' },
});
