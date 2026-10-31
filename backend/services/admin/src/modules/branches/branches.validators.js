'use strict';

const { z, directLedger } = require('@ibitplay/common');

const DAY_MS = 86_400_000;
/** Reports run the dashboard's queries over this window, so it is capped the same way. */
const MAX_SPAN_DAYS = 366;

const paging = {
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
};

const branchId = z.coerce.number().int().positive();
const search = z.string().trim().max(80).optional();

const branchUsername = z
  .string()
  .trim()
  .min(3, 'username must be at least 3 characters')
  .max(40, 'username must be at most 40 characters')
  .regex(/^[A-Za-z0-9_.-]+$/, 'username may contain letters, digits and _ . - only');

// bcrypt reads 72 bytes at most (hashPassword refuses more).
const password = z.string().min(8, 'password must be at least 8 characters').max(72, 'password must be at most 72 characters');

/** The player username rule of the site's own sign-up (user-service profile validators). */
const playerUsername = z
  .string()
  .trim()
  .min(3, 'username must be at least 3 characters')
  .max(30, 'username must be at most 30 characters')
  .regex(/^[A-Za-z0-9_.-]+$/, 'username may contain letters, digits and _ . - only');

const window = z
  .object({ from: z.coerce.date(), to: z.coerce.date() })
  .strict()
  .superRefine((q, ctx) => {
    const span = q.to.getTime() - q.from.getTime();
    if (span <= 0) ctx.addIssue({ code: 'custom', path: ['from'], message: '`from` must be before `to`' });
    else if (span > MAX_SPAN_DAYS * DAY_MS) ctx.addIssue({ code: 'custom', path: ['from'], message: `A window may span at most ${MAX_SPAN_DAYS} days` });
  });

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date as YYYY-MM-DD');

const statementQuery = z
  .object({
    fromDate: day,
    toDate: day,
    category: z.enum(['ALL', ...Object.values(directLedger.CATEGORY)]).default('ALL'),
    userId: z.coerce.number().int().positive().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict()
  .refine((q) => q.fromDate <= q.toDate, { path: ['fromDate'], message: '`fromDate` must not be after `toDate`' });

const playersQuery = z.object({ ...paging, search }).strict();

const reportWindow = {
  fromDate: day,
  toDate: day,
  userId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
};
const inOrder = (q) => q.fromDate <= q.toDate;
const orderIssue = { path: ['fromDate'], message: '`fromDate` must not be after `toDate`' };

/** Deposits / withdrawals: `status` is the word the list shows (pending, approved, success, rejected …). */
const moneyQuery = z
  .object({ ...reportWindow, status: z.string().trim().toLowerCase().regex(/^[a-z_ ]{1,30}$/).optional() })
  .strict()
  .refine(inOrder, orderIssue);

const betsQuery = z
  .object({ ...reportWindow, kind: z.enum(['originals', 'casino', 'sports']) })
  .strict()
  .refine(inOrder, orderIssue);

const playerParam = z.coerce.number().int().positive();

const createPlayerBody = z
  .object({
    username: playerUsername,
    password,
    email: z.string().trim().email().max(255).optional(),
    phone: z.string().trim().max(30).optional(),
  })
  .strict();

const withBranch = { params: z.object({ branchId }).strict() };

module.exports = {
  // Super Admin
  list: { query: z.object({ ...paging, search, status: z.enum(['active', 'inactive']).optional() }).strict() },
  create: { body: z.object({ name: z.string().trim().min(2).max(80), username: branchUsername, password }).strict() },
  update: {
    ...withBranch,
    body: z.object({ name: z.string().trim().min(2).max(80).optional(), status: z.enum(['active', 'inactive']).optional() }).strict(),
  },
  password: { ...withBranch, body: z.object({ password }).strict() },
  report: { query: window },
  summary: { ...withBranch, query: window },
  players: { ...withBranch, query: playersQuery },
  createPlayer: { ...withBranch, body: createPlayerBody },
  statement: { ...withBranch, query: statementQuery },
  player: { params: z.object({ branchId, userId: playerParam }).strict() },
  money: { ...withBranch, query: moneyQuery },
  bets: { ...withBranch, query: betsQuery },

  // The branch's own panel
  login: { body: z.object({ username: z.string().trim().min(1).max(40), password: z.string().min(1).max(200) }).strict() },
  portalSummary: { query: window },
  portalPlayers: { query: playersQuery },
  portalCreatePlayer: { body: createPlayerBody },
  portalStatement: { query: statementQuery },
  portalPlayer: { params: z.object({ userId: playerParam }).strict() },
  portalMoney: { query: moneyQuery },
  portalBets: { query: betsQuery },
};
