'use strict';

/**
 * Blog constants.
 *
 * The upload limits and the accepted image formats are NOT here — they come
 * from `../banners/banners.constants`, because a blog image and a banner image
 * are the same kind of thing and two signature tables would drift.
 */

/** Legacy's defaults, kept: they are what existing rows contain. */
const DEFAULT_AUTHOR = 'Anonymous';
const DEFAULT_CATEGORY = 'Uncategorized';

/**
 * How many posts a public list returns at once.
 *
 * `getAllBlogs` had no limit — it selected every row including every full
 * `description`, on an unauthenticated route. One request returned the entire
 * table.
 */
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * The longest a slug may be.
 *
 * `blogs.slug` is VARCHAR(255) and legacy appended `-${Date.now()}` — thirteen
 * digits — to a slug derived from the title with no length cap of its own. A
 * title over about 240 characters produced a slug the column could not hold,
 * and the INSERT failed with a database error the handler reported as a 500.
 */
const MAX_SLUG_LENGTH = 200;

module.exports = {
  DEFAULT_AUTHOR,
  DEFAULT_CATEGORY,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_SLUG_LENGTH,
};
