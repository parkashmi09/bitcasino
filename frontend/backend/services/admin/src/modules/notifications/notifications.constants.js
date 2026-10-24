'use strict';

/** What a notification is about — the app routes on this. */
const NOTIFICATION_TYPES = Object.freeze({
  GENERAL: 'general',
  DEPOSIT: 'deposit',
  WITHDRAWAL: 'withdrawal',
  BONUS: 'bonus',
  BET: 'bet',
  PROMOTION: 'promotion',
});

const NOTIFICATION_TYPE_NAMES = Object.freeze(Object.values(NOTIFICATION_TYPES));

/**
 * How many devices one broadcast may reach.
 *
 * Legacy had no ceiling and no authentication, so a single unauthenticated
 * request fanned out to every registered device on the platform. A bound turns
 * a mistake into a refusal rather than a push nobody can recall.
 */
const MAX_BROADCAST_DEVICES = 50_000;

/** Firebase's own multicast limit. Batching is not optional above it. */
const FCM_BATCH_SIZE = 500;

module.exports = { NOTIFICATION_TYPES, NOTIFICATION_TYPE_NAMES, MAX_BROADCAST_DEVICES, FCM_BATCH_SIZE };
