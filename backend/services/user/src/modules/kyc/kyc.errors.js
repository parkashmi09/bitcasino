'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('KYC', {
  NOT_FOUND: {
    status: 404,
    message: 'No KYC submission exists for this account',
  },
  ALREADY_VERIFIED: {
    status: 409,
    message: 'This account is already verified',
  },
  ALREADY_PENDING: {
    status: 409,
    message: 'A submission is already awaiting review',
  },
  DOCUMENTS_REQUIRED: {
    status: 422,
    message: 'At least one identity document is required',
  },
  REJECTION_REASON_REQUIRED: {
    status: 422,
    message: 'A reason is required when rejecting a submission',
  },
  INVALID_FILE_TYPE: {
    status: 422,
    message: 'Only JPEG, PNG and PDF files are accepted',
  },
  FILE_TOO_LARGE: {
    status: 413,
    message: 'Each document must be 5 MB or smaller',
  },
  DOCUMENT_NOT_FOUND: {
    status: 404,
    message: 'Document not found',
  },
});
