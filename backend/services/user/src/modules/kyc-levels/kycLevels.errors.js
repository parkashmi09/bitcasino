'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('KYC_LEVEL', {
  /** Level 3 before the identity KYC is Verified, or Level 4 before Level 3 is. */
  LOCKED: { status: 403, message: 'Complete the previous verification level first' },
  /** The site admin runs KYC in one step (`siteconfig.kyclevels` off): no Levels 3–4. */
  LEVELS_OFF: { status: 403, message: 'Verification levels are not offered on this site' },
  ALREADY_PENDING: { status: 409, message: 'This level is already awaiting review' },
  ALREADY_VERIFIED: { status: 409, message: 'This level is already verified' },
  DOCUMENT_REQUIRED: { status: 422, message: 'Attach the document for this level' },
  INVALID_FILE_TYPE: { status: 422, message: 'Only JPEG, PNG and PDF files are accepted' },
  FILE_TOO_LARGE: { status: 413, message: 'The document must be 5 MB or smaller' },
  NOT_FOUND: { status: 404, message: 'No such verification' },
  /** A review that is not a move from Pending. */
  NOT_PENDING: { status: 409, message: 'Only a pending verification can be reviewed' },
  REASON_REQUIRED: { status: 422, message: 'A reason is required when rejecting' },
});
