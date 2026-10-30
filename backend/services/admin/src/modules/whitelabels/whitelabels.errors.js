'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('WHITELABEL', {
  OWNER_ONLY: { status: 403, message: 'Only the Super Admin can manage whitelabels' },

  NOT_ON_A_COPY: { status: 403, message: 'A whitelabel copy cannot create whitelabels of its own' },

  DISABLED: { status: 403, message: 'Whitelabel is switched off on this site' },

  NOT_FOUND: { status: 404, message: 'Whitelabel not found' },

  TAKEN: { status: 409, message: 'That name or domain is already used by another whitelabel' },

  SAME_DOMAIN: { status: 422, message: 'The site, admin and API domains must all be different' },

  BAD_LOGO: { status: 422, message: 'The logo must be a PNG, WebP or safe SVG of at most 256 KB' },

  BAD_ICON: { status: 422, message: 'The icon must be a PNG, WebP or safe SVG of at most 256 KB' },

  BAD_POSTER: { status: 422, message: 'The poster must be a PNG, JPEG or WebP of at most 600 KB' },

  NOT_LIVE: { status: 409, message: 'This whitelabel is not running yet' },

  NOT_FAILED: { status: 409, message: 'Only a failed setup can be run again' },

  DELETE_FAILED: { status: 409, message: 'The last run was a delete — press Delete to run it again' },

  BUSY: { status: 409, message: 'A setup or delete is already running for this whitelabel' },

  MUST_BE_OFF: { status: 409, message: 'Switch the whitelabel off before deleting it' },

  NAME_MISMATCH: { status: 422, message: 'Type the whitelabel name exactly to confirm' },

  BALANCES_REMAIN: { status: 409, message: 'Money is still held on this whitelabel; confirm that you want to delete it anyway' },

  TRANSFERS_PENDING: { status: 409, message: 'A transfer to this whitelabel is still being delivered' },

  // The copy answered and refused: nothing it holds changed.
  LINK_REFUSED: { status: 502, message: 'The whitelabel refused the request' },

  // No answer (down, restarting, timed out): it may or may not have acted.
  LINK_UNREACHABLE: { status: 503, message: 'The whitelabel did not answer' },
});
