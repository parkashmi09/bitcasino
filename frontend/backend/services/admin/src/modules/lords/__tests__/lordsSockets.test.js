'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { createLogger } = require('@ibitplay/common');
const { LITERAL_EVENTS, AUDIENCE } = require('@ibitplay/socket');

const lordsSockets = require('../sockets');

/**
 * The operator console, over the socket.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * `legacy/system/sockets/adminPanelSocket.js` is the ONE socket file in that
 * codebase that authenticates properly — a JWT verified in a namespace
 * middleware, the staff row looked up, the connection refused on either
 * failure. Worth stating, because the other three files check
 * `if (!id) return;`, `if (!privates) return;`, or nothing.
 *
 * Three things still got past it, and the first is the one that matters:
 *
 *     const parentId = params?.parentId ? Number(params.parentId) : socket.staff.id;
 *
 * The default is right. The override is checked against nothing, so an agent
 * sends another agent's id and reads their entire downline — every player, with
 * balances. The staff tree exists precisely so an agent sees their own subtree.
 * ═════════════════════════════════════════════════════════════════════════
 */

const logger = createLogger({ name: 'lords-sockets-test', level: 'silent' });

/**
 * A `LordsService.allDetails` that records what it was called with.
 *
 * The scoping itself is `descendantIds(actor)` and is covered by the lords
 * service tests; what THIS file proves is that the socket handler cannot pass
 * anything other than the connection's own staff.
 */
function makeDeps() {
  const calls = [];
  return {
    calls,
    deps: {
      models: {
        Staff: { async findByPk() { return null; } },
      },
      db: {},
      logger,
      config: {},
      clients: {},
      // Injected by monkey-patching the prototype below — see `register`.
      __calls: calls,
    },
  };
}

test('the operator console over the socket', async (t) => {
  const { LordsService } = require('../lords.service');
  const { StaffService } = require('../../staff/staff.service');

  const calls = [];
  const originalAllDetails = LordsService.prototype.allDetails;
  const originalGetById = StaffService.prototype.getById;

  LordsService.prototype.allDetails = async function allDetails(args) {
    calls.push({ method: 'allDetails', args });
    return { total: 0, rows: [] };
  };
  StaffService.prototype.getById = async function getById(args) {
    calls.push({ method: 'getById', args });
    return { id: args.staffId, name: 'operator' };
  };

  t.after(() => {
    LordsService.prototype.allDetails = originalAllDetails;
    StaffService.prototype.getById = originalGetById;
  });

  const register = () => {
    const registered = new Map();
    const { deps } = makeDeps();
    lordsSockets.register({ on: (event, spec) => registered.set(event, spec), deps });
    return registered;
  };

  await t.test('every console event requires a staff credential', () => {
    const registered = register();

    /**
     * `AUDIENCE.STAFF` is satisfied by `context.staff`, which only the
     * transport sets and only from a verified `ADMIN` token plus a live staff
     * row. A player token gives `context.userId` and no `context.staff`.
     */
    for (const event of [
      LITERAL_EVENTS.GET_ADMIN_PROFILE,
      LITERAL_EVENTS.GET_USERS_ALL_DETAILS,
      LITERAL_EVENTS.STOP_USERS_ALL_DETAILS,
    ]) {
      assert.strictEqual(registered.get(event).audience, AUDIENCE.STAFF, `${event} must be staff-only`);
    }
  });

  await t.test('the profile is the caller’s own, with no id to pass', async () => {
    const registered = register();
    calls.length = 0;

    const context = { staff: { id: 42, name: 'agent' } };
    // The payload tries to name somebody else.
    await registered.get(LITERAL_EVENTS.GET_ADMIN_PROFILE).handle({ staffId: 99 }, context);

    const call = calls.find((c) => c.method === 'getById');
    assert.strictEqual(call.args.staffId, 42, 'the connection’s staff, not the payload’s');
    assert.strictEqual(call.args.actor.id, 42);
  });

  await t.test('parentId is forwarded as a request, and the actor is not', async () => {
    const registered = register();
    calls.length = 0;

    const context = { staff: { id: 42, name: 'agent' } };

    /**
     * THE DEFECT was never that `parentId` reached the query — the panel's
     * drill-down needs it to — but that legacy took it as-is, so this payload
     * returned agent 99's entire downline, balances included, to agent 42.
     *
     * What must not come from the client is `actor`: the subtree the id is
     * measured against. `LordsService.allDetails` refuses any id outside
     * `descendantIds(actor)` — see the service test — so agent 42 asking for 99
     * gets a 404 unless 99 is genuinely below them. Dropping the parameter here
     * instead made the panel's live poll answer with the caller's own children
     * whichever agent was open.
     */
    await registered
      .get(LITERAL_EVENTS.GET_USERS_ALL_DETAILS)
      .handle({ parentId: 99, page: 1, limit: 25 }, context);

    const call = calls.find((c) => c.method === 'allDetails');
    assert.strictEqual(call.args.actor.id, 42, 'the subtree comes from the connection');
    assert.strictEqual(call.args.parentId, 99, 'the drill-down target reaches the service to be checked');
  });

  await t.test('no parentId means the caller’s own children', async () => {
    const registered = register();
    calls.length = 0;

    await registered
      .get(LITERAL_EVENTS.GET_USERS_ALL_DETAILS)
      .handle({ page: 1, limit: 25 }, { staff: { id: 42 } });

    const call = calls.find((c) => c.method === 'allDetails');
    assert.strictEqual(call.args.parentId, undefined, 'the service defaults the root to the actor');
  });

  await t.test('the page size is bounded and the search is passed as a value', async () => {
    const registered = register();
    calls.length = 0;

    const context = { staff: { id: 7 } };
    await registered
      .get(LITERAL_EVENTS.GET_USERS_ALL_DETAILS)
      .handle({ limit: 100_000, page: -5, search: "o'brien" }, context);

    const call = calls.find((c) => c.method === 'allDetails');
    assert.ok(call.args.limit <= 100, 'legacy capped at 100 too, and this keeps it');
    assert.strictEqual(call.args.offset, 0, 'a negative page cannot produce a negative offset');

    /**
     * The term goes to the model layer as a VALUE. Legacy built
     * `AND lower(s.name) LIKE '%${search.toLowerCase().replace(/'/g, "''")}%'`
     * — the quote-doubling blocks the obvious injection, but it is still SQL
     * assembled from a request, and `%`/`_` inside the term were unescaped so a
     * search for `%` matched every row.
     */
    assert.strictEqual(call.args.search, "o'brien");
  });

  await t.test('there is no subscription to leak', async () => {
    const registered = register();

    /**
     * Legacy started `setInterval(fetchAndEmit, 10000)` per socket and stored
     * the handle in a per-socket variable. Calling `getUsersAllDetails` twice
     * REPLACED the handle after starting the second, so the first interval ran
     * forever with nothing holding its id — one leak per re-subscribe.
     *
     * Nothing is pushed here, so `stopUsersAllDetails` has nothing to cancel.
     * It is kept because shipped consoles send it when they navigate away.
     */
    const result = await registered.get(LITERAL_EVENTS.STOP_USERS_ALL_DETAILS).handle({}, { staff: { id: 1 } });

    assert.strictEqual(result.status, true);
    assert.strictEqual(result.subscribed, false);
  });

  await t.test('the details event is metered', () => {
    const registered = register();
    const spec = registered.get(LITERAL_EVENTS.GET_USERS_ALL_DETAILS);

    // Each call runs the staff query and the player query; legacy ran both
    // every ten seconds per connected console with no ceiling on subscriptions.
    assert.ok(spec.limit.max <= 12);
  });
});
