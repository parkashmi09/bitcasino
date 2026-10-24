'use strict';

const { z } = require('@ibitplay/common');

const id = z.coerce.number().int().positive();

/** Zip ka `alpha_num` — sirf a-z, A-Z, 0-9. */
const username = z.string().regex(/^[a-zA-Z0-9]+$/, 'The User Name field may only contain alpha-numeric characters');

/** GET /check-username?username= */
const checkUsername = {
  query: z.object({ username: z.string().trim().min(1).max(60) }).strict(),
};

/**
 * POST /create — zip ka Create Account form (users/InsertUser.jsx).
 * userType: 'USER' ya staff ka level (2 Admin … 6 Agent). Credit Amount khali = 0.
 */
const createAccount = {
  body: z
    .object({
      username: username.min(4, 'The User Name field must be at least 4 characters').max(60),
      fullname: z.string().trim().max(120).optional(),
      // Staff (Admin … Agent) ke liye zaroori — login aur contact ke liye asli email. User pe nahi lagti.
      email: z.string().trim().toLowerCase().email('The Email field must be a valid email').max(190).optional(),
      password: z.string().min(8).max(200),
      city: z.string().trim().max(120).optional(),
      phone: z.string().trim().regex(/^\d*$/, 'The Mobile Number field may only contain numeric characters').max(15).optional(),
      creditAmount: z.string().trim().max(20).optional(),
      userType: z.union([z.literal('USER'), id]), // 'USER' ya staff level 2..6
      percentage: z.string().trim().max(10).optional(),
      remark: z.string().trim().max(500).optional(),
      transactionPassword: z.string().max(200).optional(),
    })
    .strict(),
};

// ── System Tracker ────────────────────────────────────────────────────

const trackerSearch = { query: z.object({ q: z.string().trim().max(100).optional() }).strict() };
const trackerAccount = { params: z.object({ idOrUsername: z.string().trim().min(1).max(100) }) };
const watchdogList = { query: z.object({ all: z.enum(['0', '1']).optional() }).strict() };
const watchdogAck = { params: z.object({ id }), body: z.object({}).strict() };

module.exports = {
  checkUsername,
  createAccount,
  trackerSearch,
  trackerAccount,
  watchdogList,
  watchdogAck,
};
