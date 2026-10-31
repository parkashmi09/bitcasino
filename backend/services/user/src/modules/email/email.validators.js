'use strict';

const { z } = require('@ibitplay/common');

const { PUBLIC_PURPOSES, OTP_LENGTH } = require('./email.constants');

const email = z.string().trim().toLowerCase().email().max(190);

const requestOtp = {
  body: z.object({ email, purpose: z.enum(PUBLIC_PURPOSES) }).strict(),
};

const verifyOtp = {
  body: z
    .object({
      email,
      purpose: z.enum(PUBLIC_PURPOSES),
      // Exactly the code, not a prefix of one. Legacy compared whatever arrived.
      code: z.string().trim().regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), `code must be ${OTP_LENGTH} digits`),
    })
    .strict(),
};

/** Email OR username — never both, and never an id. */
const identifier = z.string().trim().min(1).max(190);

const resetTwoFactor = { body: z.object({ identifier }).strict() };

const confirmTwoFactor = {
  body: z
    .object({
      identifier,
      code: z.string().trim().regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), `code must be ${OTP_LENGTH} digits`),
    })
    .strict(),
};

const message = {
  subject: z.string().trim().min(1).max(200),
  title: z.string().trim().max(200).optional(),
  content: z.string().min(1).max(50_000),
  ctaLink: z.string().trim().url().max(2048).optional(),
  ctaText: z.string().trim().max(80).optional(),
};

const sendToPlayer = { body: z.object({ to: email, ...message }).strict() };

const sendBulk = {
  body: z
    .object({
      // Bounded at the edge as well as in the service — a 100k-element array
      // costs memory before any handler sees it.
      emails: z.array(email).min(1).max(500),
      ...message,
    })
    .strict(),
};

/** `POST /user/email/verify/confirm`: the code only — the address is the account's own. */
const confirmVerifyEmail = {
  body: z
    .object({ code: z.string().trim().regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), `code must be ${OTP_LENGTH} digits`) })
    .strict(),
};

module.exports = { confirmVerifyEmail, requestOtp, verifyOtp, resetTwoFactor, confirmTwoFactor, sendToPlayer, sendBulk };
