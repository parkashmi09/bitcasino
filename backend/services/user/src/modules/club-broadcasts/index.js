'use strict';

/**
 * Club banners and the notifications that announce them.
 *
 *   ALL SIX TABLES BEHIND THESE TWELVE ROUTES WERE MISSING. Every banner
 *   upload, every send and every read receipt has returned 500 since the day it
 *   was written. Migration 019 creates them — the same story as
 *   `club_memberships` in migration 014.
 *
 *   `GET /clubs/banner-image/:imagePath(*)` WAS A PATH TRAVERSAL. A wildcard
 *   path parameter joined onto a storage root, unauthenticated, with no
 *   containment check: `../../../../etc/passwd` — or `legacy/.env`, or the
 *   committed Firebase key — was read and returned.
 *
 *   OWNERSHIP CAME FROM THE REQUEST BODY. `WHERE id = $1 AND owner_id = $2`
 *   looks like a check and is not, because the caller supplied `$2`.
 *
 *   EVERYTHING WAS WRITTEN TWICE, once per notification kind, and the copies
 *   had drifted — the banner sender required an active club, the plain one did
 *   not.
 *
 *   THE FAN-OUT WAS A QUERY PER MEMBER with no unique key, so re-sending a
 *   notification produced a second delivery row per member and the read receipt
 *   updated whichever one it found.
 */
module.exports = {
  name: 'club-broadcasts',
  service: 'user',
  basePath: '/club-broadcasts',
  models: ['core', 'extended'],
  routers: {
    user: require('./routes/user.routes'),
  },
};
