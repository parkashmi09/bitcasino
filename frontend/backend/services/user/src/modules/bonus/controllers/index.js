'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  const page = (q) => ({ page: Math.floor(q.offset / q.limit) + 1, limit: q.limit });
  const paged = async (res, q, promise) => {
    const result = await promise;
    return response.paginated(res, result.rows, { ...page(q), total: result.total });
  };

  return {
    // ── Players ───────────────────────────────────────────────────────

    /** @legacy GET /Userbonus/api/bonuses */
    overview: asyncHandler(async (req, res) => response.ok(res, await service.overview({ userId: req.user.id }))),

    /** @legacy GET /Userbonus/api/bonus-history */
    history: asyncHandler(async (req, res) =>
      paged(res, req.query, service.history({ ...req.query, userId: req.user.id }))
    ),

    /** @legacy POST /Userbonus/api/bonuses/claim/:type */
    claim: asyncHandler(async (req, res) =>
      response.ok(res, await service.claim({ userId: req.user.id, type: req.params.type }))
    ),

    /** @legacy POST /bonus/redeem-bonus/redeem */
    redeem: asyncHandler(async (req, res) =>
      response.ok(res, await service.redeemCode({ ...req.body, userId: req.user.id }))
    ),

    /** @legacy POST /bonus/user */
    myCodes: asyncHandler(async (req, res) =>
      paged(res, req.query, service.myCodes({ ...req.query, userId: req.user.id }))
    ),

    /** @legacy POST /bonus/userbonus */
    myRecord: asyncHandler(async (req, res) =>
      response.ok(res, await service.myBonusRecord({ userId: req.user.id }))
    ),

    /** @legacy POST /bonus/bonusgame */
    myBonusGame: asyncHandler(async (req, res) =>
      response.ok(res, await service.myBonusGame({ userId: req.user.id }))
    ),

    /** @legacy POST /bonus/bonushistory */
    myEvents: asyncHandler(async (req, res) =>
      paged(res, req.query, service.myEvents({ ...req.query, userId: req.user.id }))
    ),

    // ── Staff ─────────────────────────────────────────────────────────

    /** @legacy GET /bonus/admin/userbonus */
    listRecords: asyncHandler(async (req, res) => paged(res, req.query, service.listRecords(req.query))),

    /** @legacy GET /bonus/admin/bonusgame */
    listBonusGames: asyncHandler(async (req, res) => paged(res, req.query, service.listBonusGames(req.query))),

    /** @legacy GET /bonus/admin/bonushistory */
    listEvents: asyncHandler(async (req, res) => paged(res, req.query, service.listEvents(req.query))),

    listAwards: asyncHandler(async (req, res) => paged(res, req.query, service.listAwards(req.query))),

    /** @legacy GET /bonus/users */
    listUserIds: asyncHandler(async (req, res) => response.ok(res, await service.listUserIds(req.query))),

    /** @legacy POST /bonus/createuserbonus */
    createRecord: asyncHandler(async (req, res) => response.created(res, await service.createRecord(req.body))),

    /** @legacy PUT /bonus/userbonus */
    updateRecord: asyncHandler(async (req, res) => response.ok(res, await service.updateRecord(req.body))),

    /** @legacy DELETE /bonus/userbonus */
    deleteRecord: asyncHandler(async (req, res) => response.ok(res, await service.deleteRecord(req.body))),

    /** @legacy POST /bonus/redeem-bonus/create */
    createCode: asyncHandler(async (req, res) => response.created(res, await service.createCode(req.body))),

    /** @legacy GET /bonus/redeem-bonus */
    listCodes: asyncHandler(async (req, res) => paged(res, req.query, service.listCodes(req.query))),

    // ── Per-game counters ─────────────────────────────────────────────

    /** @legacy POST /bonus/createbonusgame */
    createBonusGame: asyncHandler(async (req, res) => {
      const result = await service.createBonusGame(req.body);
      // `created: false` means the row was already there — a second call is not
      // a second row, which is the whole point of the unique key.
      return result.created ? response.created(res, result) : response.ok(res, result);
    }),

    /** @legacy PUT /bonus/bonusgame */
    grantBonusGame: asyncHandler(async (req, res) =>
      response.ok(res, await service.grantBonusGame({ ...req.body, staffId: req.staff?.id ?? null }))
    ),

    /** @legacy DELETE /bonus/bonusgame */
    deleteBonusGame: asyncHandler(async (req, res) =>
      response.ok(res, await service.deleteBonusGame(req.body))
    ),

    // ── The event log ─────────────────────────────────────────────────

    /** @legacy POST /bonus/createbonushistory */
    createEvent: asyncHandler(async (req, res) => response.created(res, await service.createEvent(req.body))),

    /** @legacy PUT /bonus/bonushistory */
    updateEvent: asyncHandler(async (req, res) =>
      response.ok(res, await service.updateEvent({ id: req.params.id, ...req.body }))
    ),

    /** @legacy DELETE /bonus/bonushistory */
    deleteEvent: asyncHandler(async (req, res) =>
      response.ok(res, await service.deleteEvent({ id: req.params.id }))
    ),

    /** @legacy GET /Adminbonus/api/admin/bonuses */
    dashboard: asyncHandler(async (req, res) => response.ok(res, await service.adminDashboard(req.query))),

    /** @legacy GET /Userbonus/debug-bonus/:userId */
    inspect: asyncHandler(async (req, res) =>
      response.ok(res, await service.overview({ userId: req.params.userId }))
    ),
  };
}

module.exports = { createControllers };
