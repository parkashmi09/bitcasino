'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('JSCURATION', {
  COLLECTION_NOT_FOUND: { status: 404, message: 'No such collection' },
  SCOPE_NOT_FOUND: { status: 404, message: 'No such curation scope' },
  /**
   * Distinct from "the list is empty". A uid that names no row is an operator
   * about to publish a tile that cannot be opened, so the write is refused and
   * says which ones — rather than being silently dropped, which is what the
   * aggregator's `#verifiedIds` does and why a saved collection could come back
   * shorter than it went in with no explanation.
   */
  UNKNOWN_GAMES: { status: 422, message: 'Some of those games are not in the catalogue' },
  LIST_TOO_LARGE: { status: 422, message: 'That list is longer than a curated list may be' },
});
