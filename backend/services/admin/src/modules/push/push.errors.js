'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('PUSH', {
  NOT_FOUND: { status: 404, message: 'Campaign not found' },
  IMAGE_NOT_FOUND: { status: 404, message: 'Image not found' },
  TEMPLATE_NOT_FOUND: { status: 404, message: 'No such push template' },
  NOT_IN_YOUR_TREE: { status: 404, message: 'Player not found' },
  BAD_STATE: { status: 409, message: 'The campaign cannot do that in its current status' },
  AUDIENCE_NOT_ALLOWED: {
    status: 403,
    // Segments and tag filters reach every matching subscriber of the app, not
    // only the caller's tree — so only a top-level operator may use them.
    message: 'Only a top-level operator may target OneSignal segments, tag filters or every subscriber',
  },
  AUDIENCE_EMPTY: { status: 422, message: 'Nobody in that audience' },
  AUDIENCE_TOO_LARGE: { status: 422, message: 'That audience is larger than one campaign may reach' },
  PUSH_NOT_CONFIGURED: {
    status: 501,
    message: 'OneSignal is not ready: switch on the OneSignal variant with an App ID and App API key',
  },
  BAD_URL: { status: 422, message: 'That URL cannot be used in a push' },
  SEND_AT_PAST: { status: 422, message: 'The schedule time must be in the future' },
  PROVIDER_FAILED: { status: 502, message: 'OneSignal refused the send' },
  // The image upload set (imageUpload.inspect needs these five).
  NO_FILE: { status: 422, message: 'No image was uploaded (field "image")' },
  TOO_LARGE: { status: 413, message: 'A push image may be at most 1 MB' },
  TOO_SMALL: { status: 422, message: 'That file is too small to be an image' },
  FORMAT_REFUSED: { status: 415, message: 'That image format is not accepted' },
  NOT_AN_IMAGE: { status: 415, message: 'Only PNG, JPEG, WebP or GIF images are accepted' },
  // The notification sound upload.
  SOUND_NO_FILE: { status: 422, message: 'No sound was uploaded (field "sound")' },
  SOUND_TOO_LARGE: { status: 413, message: 'A notification sound may be at most 300 KB' },
  NOT_A_SOUND: { status: 415, message: 'Only MP3, WAV or OGG sounds are accepted' },
  SOUND_NOT_FOUND: { status: 404, message: 'Sound not found' },
});
