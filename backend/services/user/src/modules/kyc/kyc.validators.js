'use strict';

const { z } = require('@ibitplay/common');
const { KYC_STATUSES, DOCUMENT_TYPE } = require('./kyc.constants');

/** Submission details. The user id is NOT here — it comes from the token. */
const submit = {
  body: z.object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
    dateOfBirth: z.coerce.date().refine(
      (d) => {
        const age = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
        return age >= 18 && age <= 120;
      },
      // The platform cannot legally serve under-18s, and KYC is where that is
      // established. Legacy did not check the date at all.
      { message: 'You must be at least 18 years old' }
    ),
    address: z.string().trim().min(1).max(500),
    city: z.string().trim().min(1).max(100),
    country: z.string().trim().min(2).max(100),
    documentType: z.enum(Object.values(DOCUMENT_TYPE)),
  }),
};

const review = {
  body: z
    .object({
      userId: z.coerce.number().int().positive(),
      status: z.enum(KYC_STATUSES),
      rejectionReason: z.string().trim().max(500).optional(),
    })
    .strict()
    .refine((v) => v.status !== 'Rejected' || Boolean(v.rejectionReason), {
      message: 'A rejection reason is required when rejecting',
      path: ['rejectionReason'],
    }),
};

const listApplications = {
  query: z.object({
    status: z.enum(KYC_STATUSES).optional(),
    search: z.string().trim().max(100).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }),
};

const userParam = { params: z.object({ userId: z.coerce.number().int().positive() }) };

/**
 * A document id, not a filename.
 *
 * Legacy served `GET /kyc/documents/:filename` off the filesystem, filtering
 * only for `..` and `/`. That is a denylist on a path — everything else was
 * fetchable, and every KYC document on the platform was readable by anyone who
 * could guess a name. Documents are now addressed by record id and served only
 * to their owner or to staff.
 */
const documentParam = {
  params: z.object({
    kycId: z.coerce.number().int().positive(),
    field: z.enum(['idFront', 'idBack', 'passport']),
  }),
};

module.exports = { submit, review, listApplications, userParam, documentParam };
