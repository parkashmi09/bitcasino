'use strict';

/** KYC review states. Legacy used these exact strings; the admin UI branches on them. */
const KYC_STATUS = Object.freeze({
  // `user_kyc.status` defaults to 'Unverified' in the schema, so rows written
  // before this module existed carry it. Included so a status filter can find
  // them rather than silently excluding every historical row.
  UNVERIFIED: 'Unverified',
  PENDING: 'Pending',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
});

const KYC_STATUSES = Object.freeze(Object.values(KYC_STATUS));

const DOCUMENT_TYPE = Object.freeze({
  ID_CARD: 'id_card',
  PASSPORT: 'passport',
  DRIVING_LICENCE: 'driving_licence',
});

/**
 * Accepted uploads.
 *
 * Legacy checked `file.mimetype`, which is whatever the client claims. The
 * magic bytes are what the file actually is — a `.png` that starts with `MZ`
 * is an executable regardless of the header the browser sent.
 */
const ALLOWED_MIME = Object.freeze(['image/jpeg', 'image/png', 'application/pdf']);

const MAGIC_BYTES = Object.freeze([
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
]);

const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Which fields a submission may carry a file on. */
const DOCUMENT_FIELDS = Object.freeze(['idFront', 'idBack', 'passport']);

const PERMISSION = Object.freeze({
  READ: 'users:read',
  REVIEW: 'users:write',
});

module.exports = {
  KYC_STATUS,
  KYC_STATUSES,
  DOCUMENT_TYPE,
  ALLOWED_MIME,
  MAGIC_BYTES,
  MAX_FILE_BYTES,
  DOCUMENT_FIELDS,
  PERMISSION,
};
