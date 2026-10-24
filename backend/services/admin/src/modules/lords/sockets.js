'use strict';

const { LITERAL_EVENTS, AUDIENCE } = require('@ibitplay/socket');

const { LordsService } = require('./lords.service');
const { StaffService } = require('../staff/staff.service');

/**
 * The operator console, over the socket.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE ONE LEGACY SOCKET FILE THAT AUTHENTICATED PROPERLY — AND STILL LEAKED
 *
 * `legacy/system/sockets/adminPanelSocket.js` is the exception in that
 * codebase: it verifies a JWT in a namespace middleware, looks the staff row
 * up, and refuses the connection if either fails. Worth saying, because it is
 * the only socket surface in the platform that does.
 *
 * Two things got past it.
 *
 * ── 1. `parentId` CAME FROM THE CLIENT ───────────────────────────────────
 *
 *     const parentId = params?.parentId ? Number(params.parentId) : socket.staff.id;
 *
 * The default is right; the override is not checked against anything. An agent
 * sends `{parentId: <someone else's id>}` and reads that agent's entire
 * downline — every player under them, with balances. The whole point of the
 * staff tree is that an agent sees their own subtree, and one optional
 * parameter opted out of it.
 *
 * `LordsService.allDetails` accepts a `parentId` — the panel's drill-down needs
 * one — but checks it against `descendantIds(actor)` before reading anything,
 * so an id outside the caller's tree is a refusal rather than someone else's
 * downline. This socket forwards it on those terms. It used to drop it, on the
 * grounds that a parameter never read cannot be abused; the cost was that the
 * panel's live poll answered with the caller's own children no matter which
 * agent was open, so a drilled-down table snapped back to the top level every
 * ten seconds. Forwarding a *checked* id restores the feature without
 * restoring the hole — what legacy trusted was the id itself, not the request.
 *
 * ── 2. THE SEARCH TERM WAS CONCATENATED INTO SQL ─────────────────────────
 *
 *     const searchFilter = search.length >= 3
 *       ? `AND lower(s.name) LIKE '%${search.toLowerCase().replace(/'/g, "''")}%'`
 *       : '';
 *
 * The quote-doubling does block the obvious injection, so this is not the hole
 * it looks like — but it is SQL assembled from a request value, and the `%`
 * and `_` wildcards inside the term are not escaped, so a search for `%`
 * matches every row. It goes through the model layer here.
 *
 * ── 3. A TEN-SECOND POLL PER CONNECTED CONSOLE ───────────────────────────
 *
 *     fetchAndEmit();
 *     detailsInterval = setInterval(fetchAndEmit, 10000);
 *
 * Each tick runs the staff query and the player query. The interval is stored
 * in a per-socket variable and cleared on `stopUsersAllDetails` and on
 * disconnect — which is correct — but calling `getUsersAllDetails` twice
 * without stopping REPLACES the handle after starting the second, so the first
 * interval runs forever with nothing holding its id. Every re-subscribe leaks
 * one.
 *
 * There is no interval here. The console asks and is answered; a console that
 * wants a live view asks again. `stopUsersAllDetails` is kept as a no-op that
 * says so, because shipped clients send it.
 * ═════════════════════════════════════════════════════════════════════════
 */

const ok = (payload) => ({ status: true, ...payload });
const refuse = (error) => ({ status: false, msg: error.message, error: { code: error.code } });

function register({ on, deps }) {
  const lords = new LordsService(deps);
  const staff = new StaffService(deps);

  /**
   * @legacy SOCKET getAdminProfile
   *
   * The caller's own staff record. `actor` is the connection's staff, so there
   * is no id to pass and none to forge.
   */
  on(LITERAL_EVENTS.GET_ADMIN_PROFILE, {
    audience: AUDIENCE.STAFF,
    limit: { windowMs: 60_000, max: 60 },
    handle: async (_payload, context) => {
      try {
        const actor = context.staff;
        return ok({ profile: await staff.getById({ actor, staffId: actor.id }) });
      } catch (error) {
        if (error.code?.startsWith('STAFF_') || error.code?.startsWith('LORDS_')) return refuse(error);
        throw error;
      }
    },
  });

  /**
   * @legacy SOCKET getUsersAllDetails
   *
   * The caller's direct sub-agents and their own players — the same rows, in
   * the same envelope, as the HTTP listing, because the panel's downline table
   * is fed by both and cannot tell them apart. One answer per request; see the
   * header for why the ten-second interval is gone.
   */
  on(LITERAL_EVENTS.GET_USERS_ALL_DETAILS, {
    audience: AUDIENCE.STAFF,
    /**
     * Six a minute is the cadence legacy's interval ran at, so a console that
     * genuinely wants that refresh rate can still have it — at its own cost
     * rather than the database's, and only while somebody is watching.
     */
    limit: { windowMs: 60_000, max: 12 },
    handle: async (payload, context) => {
      try {
        const page = Math.max(1, Number(payload?.page ?? 1));
        const limit = Math.min(100, Math.max(1, Number(payload?.limit ?? 25)));

        const result = await lords.allDetails({
          // `actor` still comes from the connection and cannot be named by the
          // client — that is what closed the legacy hole. `parentId` is only a
          // drill-down request: the service checks it against this actor's own
          // descendants and throws LORDS_NOT_IN_YOUR_TREE otherwise, so it can
          // reach a sub-agent's children and nothing else.
          actor: context.staff,
          parentId: payload?.parentId != null ? Number(payload.parentId) : undefined,
          search: payload?.search ? String(payload.search) : undefined,
          limit,
          offset: (page - 1) * limit,
        });

        /**
         * `data` and `pagination`, matching the HTTP listing.
         *
         * The panel polls this event and renders the reply with the same code
         * that renders `GET /admin/accounts/` — it takes the rows from `data`
         * and the count from `pagination.totalPages`. Replying `users` and
         * `totalPages` off the top level, as this did, meant the poll ran every
         * ten seconds and silently discarded every answer.
         */
        return ok({
          data: result.rows,
          pagination: {
            page,
            limit,
            total: result.total,
            totalPages: Math.ceil(result.total / limit),
            hasNext: page * limit < result.total,
            hasPrev: page > 1,
          },
        });
      } catch (error) {
        if (error.code?.startsWith('LORDS_') || error.code?.startsWith('STAFF_')) return refuse(error);
        throw error;
      }
    },
  });

  /**
   * @legacy SOCKET stopUsersAllDetails
   *
   * A no-op, kept because shipped consoles send it when they navigate away.
   * There is no subscription to cancel — nothing is pushed — so answering
   * `{status: true}` is honest and removing the event would 404 a client that
   * is behaving correctly.
   */
  on(LITERAL_EVENTS.STOP_USERS_ALL_DETAILS, {
    audience: AUDIENCE.STAFF,
    handle: async () => ok({ subscribed: false }),
  });
}

module.exports = { register };
