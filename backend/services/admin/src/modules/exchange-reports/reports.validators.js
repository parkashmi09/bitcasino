'use strict';

const { z } = require('@ibitplay/common');

const id = z.coerce.number().int().positive();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');

/** "Search By Client Name" me chuna account — player ya staff. */
const client = {
  clientType: z.enum(['user', 'staff']).optional(),
  clientId: id.optional(),
  // Direct Users | Agent Users tab; na ho = dono
  channel: z.enum(['direct', 'agent']).optional(),
};

const days = (q) => (new Date(q.toDate) - new Date(q.fromDate)) / 86_400_000;

/** Zip ka dateRangeMiddleware: max 10 din, aur pichhle 3 mahine ke andar. */
const RANGE_MESSAGE = 'Sorry for inconvenience! You will see statement of 10 days date range in 3 months timeslot.';
function inTenDayWindow(q) {
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  threeMonthsAgo.setHours(0, 0, 0, 0);
  return days(q) >= 0 && days(q) <= 10 && new Date(`${q.fromDate}T00:00:00`) >= threeMonthsAgo;
}

/** GET /exchange/reports/clients?search=abc */
const clients = {
  query: z.object({ search: z.string().trim().min(1).max(100), channel: client.channel }).strict(),
};

/** POST /exchange/reports/statement — zip statementv2, max 7 din (maxDateRange(7)). */
const statement = {
  body: z
    .object({
      ...client,
      reportType: z.enum(['TRANSACTION', 'SPORTS'], { message: 'reportType required' }),
      fromDate: day,
      toDate: day,
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(150).default(25),
      statement: z.string().trim().max(20).default('all'),
      sportId: z.string().trim().max(10).optional(),
      gameType: z.string().trim().max(30).optional(),
    })
    .strict()
    .refine((q) => days(q) >= 0, { message: 'fromDate cannot be after toDate.' })
    .refine((q) => days(q) <= 7, { message: 'Date range cannot be more than 7 days.' }),
};

/** POST /exchange/reports/statement/bet-detail | bet-export — statement ki game row. */
const statementRow = {
  body: z.object({ betId: id, category: z.literal('SPORTS') }).strict(),
};

/** GET /exchange/reports/party-win-loss */
const partyWinLoss = {
  query: z
    .object({
      type: z.enum(['all', 'user']).default('all'),
      search: z.string().trim().max(100).optional(),
      channel: client.channel,
    })
    .strict(),
};

/** POST /exchange/reports/user-win-loss — zip point-category-report. */
const userWinLoss = {
  body: z
    .object({ ...client, fromDate: day, toDate: day })
    .strict()
    .refine(inTenDayWindow, { message: RANGE_MESSAGE }),
};

/** POST /exchange/reports/direct-user-win-loss — User Win Loss ka Direct Users tab (channel hamesha direct). */
const directUserWinLoss = {
  body: z
    .object({ clientType: client.clientType, clientId: client.clientId, fromDate: day, toDate: day })
    .strict()
    .refine(inTenDayWindow, { message: RANGE_MESSAGE }),
};

/** POST /exchange/reports/direct-bet-history — direct user ki point_ledger_direct entries, max 31 din. */
const directBetHistory = {
  body: z
    .object({
      clientId: id,
      fromDate: day,
      toDate: day,
      category: z.enum(['ALL', 'SPORTS', 'CASINO', 'ORIGINAL_GAME']).default('ALL'),
      currency: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/, 'A currency code like INR').optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    })
    .strict()
    .refine((q) => days(q) >= 0, { message: 'fromDate cannot be after toDate.' })
    .refine((q) => days(q) <= 31, { message: 'Date range cannot be more than 31 days.' }),
};

/** POST /exchange/reports/total-profit-loss — sirf sports (sportbook hamare yahan nahi). */
const totalProfitLoss = {
  body: z
    .object({ ...client, fromDate: day, toDate: day })
    .strict()
    .refine(inTenDayWindow, { message: RANGE_MESSAGE }),
};

/** POST /exchange/reports/turnover — sirf sports (sport_id zaroori). */
const turnover = {
  body: z
    .object({
      ...client,
      fromDate: day,
      toDate: day,
      sportId: z.string().trim().min(1, 'sport_id is required for sports type').max(10),
      gtype: z.string().trim().max(30).optional(),
    })
    .strict()
    .refine(inTenDayWindow, { message: RANGE_MESSAGE }),
};

module.exports = { clients, statement, statementRow, partyWinLoss, userWinLoss, directUserWinLoss, directBetHistory, totalProfitLoss, turnover };
