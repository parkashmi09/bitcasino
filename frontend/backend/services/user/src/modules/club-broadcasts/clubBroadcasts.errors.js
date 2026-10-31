'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('CLUBCAST', {
  NOT_CLUB_OWNER: { status: 403, message: 'Only the club owner can do that' },
  CLUB_NOT_FOUND: { status: 404, message: 'Club not found' },
  BANNER_NOT_FOUND: { status: 404, message: 'Banner not found' },
  NOTIFICATION_NOT_FOUND: { status: 404, message: 'Notification not found' },
  NOT_A_MEMBER: { status: 403, message: 'You are not a member of that club' },

  IMAGE_NOT_FOUND: {
    status: 404,
    /**
     * ONE answer for "no such file", "outside the storage root" and "not an
     * image". `GET /clubs/banner-image/:imagePath(*)` was a path traversal:
     *
     *     const fullPath = path.join(ROOT, req.params.imagePath);
     *
     * with a wildcard parameter and no containment check, on an unauthenticated
     * route. `../../../../etc/passwd` — or `legacy/.env`, or the committed
     * Firebase key — resolved outside the root and was read and returned.
     *
     * Distinguishing the refusals would turn the endpoint back into a probe for
     * which files exist on the host.
     */
    message: 'Image not found',
  },

  IMAGE_TOO_LARGE: { status: 413, message: 'That image is too large' },
  IMAGE_TYPE_NOT_ALLOWED: { status: 422, message: 'Banners must be a JPEG, PNG or WebP image' },

  TOO_MANY_BANNERS: {
    status: 409,
    // A club banner list is loaded whole by every member's app.
    message: 'This club already has the maximum number of banners',
  },
});
