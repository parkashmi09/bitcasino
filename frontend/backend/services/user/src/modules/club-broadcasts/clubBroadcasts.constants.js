'use strict';

/**
 * The two broadcast kinds share a shape, so they share an implementation.
 *
 * A free-standing notification and a banner-linked one differ only by carrying
 * a `banner_id`, and each has its own pair of tables. Legacy wrote the sender,
 * the fan-out, the listing and the read-receipt logic TWICE — once per kind —
 * and the two copies had already diverged: the banner version filtered
 * `is_active` on the club and the plain one did not.
 */
const CHANNEL = Object.freeze({
  club: {
    notifications: 'ClubNotification',
    status: 'ClubNotificationStatus',
    hasBanner: false,
  },
  banner: {
    notifications: 'ClubBannerNotification',
    status: 'ClubBannerNotificationStatus',
    hasBanner: true,
  },
});

/** What a banner image may be. Checked by MAGIC BYTES, not by file extension. */
const IMAGE_TYPES = Object.freeze({
  'image/jpeg': { ext: '.jpg', magic: [[0xff, 0xd8, 0xff]] },
  'image/png': { ext: '.png', magic: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]] },
  'image/webp': {
    ext: '.webp',
    // RIFF....WEBP — the first four bytes, then the format tag at offset 8.
    magic: [[0x52, 0x49, 0x46, 0x46]],
    at8: [0x57, 0x45, 0x42, 0x50],
  },
});

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Banners one club may hold. Every member's app loads the list. */
const MAX_BANNERS_PER_CLUB = 20;

/** Notification kinds the sender accepts. */
const NOTIFICATION_TYPES = Object.freeze(['general', 'banner', 'announcement', 'promotion']);

module.exports = { CHANNEL, IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_BANNERS_PER_CLUB, NOTIFICATION_TYPES };
