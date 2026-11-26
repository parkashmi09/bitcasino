'use strict';

const { defineErrors } = require('@ibitplay/common');

/** `POST /user/profile/avatar` — codes the Edit Avatar grid branches on. */
module.exports = defineErrors('AVATAR', {
  NOT_FOUND: { status: 404, message: 'That avatar is not available' },
  DISABLED: { status: 403, message: 'Avatars are switched off on this site' },
  LOCKED: { status: 403, message: 'Reach a higher VIP level to unlock this avatar' },
});
