'use strict';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_SLUG_LENGTH = 200;

const SEGMENTS = ['casino', 'sports'];
const PROMO_STATUSES = ['live', 'ended'];

const ARTICLE_EMBED_MARKER = '<div class="Flex_root Flex_column Flex_md2"></div>';

/** Icon keys map to `/icons/{key}.svg` on the player site. */
const SIDEBAR_ICONS = [
  'promotions',
  'trophy',
  'promos/multi',
  'promos/diamond',
  'promos/highest-multiplier',
  'promos/vip',
  'promos/vip-bonus',
  'sports/race-wager',
  'dice',
  'sports',
];

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_SLUG_LENGTH,
  SEGMENTS,
  PROMO_STATUSES,
  ARTICLE_EMBED_MARKER,
  SIDEBAR_ICONS,
};
