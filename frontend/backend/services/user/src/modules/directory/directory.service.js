'use strict';

const { Op, fn, col, literal } = require('sequelize');
const { defineErrors } = require('@ibitplay/common');

const E = defineErrors('DIRECTORY', {
  NOT_FOUND: { status: 404, message: 'Player not found' },

  DELETE_NOT_SUPPORTED: {
    status: 501,
    /**
     * See `#refuseDelete`. `DELETE /deleteUser` walked `information_schema`
     * and deleted from every table with a user-shaped column. That is not a
     * feature with a bug in it — it is a data-destruction tool wearing an API,
     * and the honest port is to refuse and say why.
     */
    message:
      'Erasing a player across every table is not available through the API. ' +
      'Closing an account is a status change; an erasure request needs a reviewed, ' +
      'auditable procedure that preserves the financial record.',
  },
});

/**
 * The player directory, for operators.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * `GET /users` WAS `SELECT * FROM users`, UNAUTHENTICATED
 *
 *     server.get('/users', async (req, res) => {
 *       const result = await pg.query('SELECT * FROM users');
 *       res.json(result.rows);
 *     });
 *
 * Every row, every column, to anyone who asked — including `password` and
 * `password2`, which are the bcrypt hashes `verifyPassword()` checks at login,
 * plus every email address and phone number on the platform. One GET was a full
 * account dump.
 *
 * Columns are an explicit allow-list here, and the route is staff-scoped.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * `GET /user-summary` MULTIPLIED EVERY TOTAL BY THE OTHER TABLE'S ROW COUNT
 *
 *     FROM users u
 *     LEFT JOIN deposits d    ON u.id = d.uid
 *     LEFT JOIN withdrawals w ON u.id = w.uid
 *     GROUP BY u.id
 *     -- SUM(d.amount), SUM(w.amount)
 *
 * Joining two independent one-to-many tables in one query is a cartesian
 * product: a player with 3 deposits and 4 withdrawals produces 12 rows, so
 * `SUM(d.amount)` counts each deposit FOUR times and `SUM(w.amount)` counts
 * each withdrawal THREE times. Every figure on that report was inflated by the
 * count of the other table, and the more active the player the more wrong it
 * was. The two sides are aggregated separately here and joined in JavaScript.
 */
class DirectoryService {
  constructor({ models, config, logger, clients }) {
    this.models = models;
    this.config = config;
    this.logger = logger;
    this.clients = clients;
  }

  /**
   * The columns an operator may see.
   *
   * Explicit, and it does not include `password`, `password2`, or any of the
   * seed columns behind provably-fair play. Legacy answered with `SELECT *`.
   */
  static SAFE_COLUMNS = Object.freeze([
    'id',
    'name',
    'email',
    'phone',
    'status',
    'is_locked',
    'system_locked',
    'bet_status',
    'parent_staff_id',
    /**
     * `created`, NOT `created_at`.
     *
     * The column on `users` is `created`; `created_at` does not exist on that
     * table and never has. Sequelize passes an unrecognised attribute name
     * straight through to the SELECT list, so this did not fail at boot or in
     * `db:verify` — it failed at runtime, with
     * `column "created_at" does not exist`, on every request to the player
     * directory. Both listing routes were a 500.
     *
     * (`updated_at` IS the real name of its sibling, which is most of why the
     * wrong one looked right.)
     */
    'created',
  ]);

  /**
   * @legacy GET /users
   * @legacy GET /getUserData
   *
   * The two were the same listing behind different names.
   */
  async list({ search, status, limit, offset, staffId }) {
    const visible = await this.#visibleStaffIds(staffId);

    const where = {};
    if (!visible.all) where.parent_staff_id = { [Op.in]: visible.ids };
    if (status) where.status = status;

    if (search) {
      const term = `%${String(search).trim()}%`;
      where[Op.or] = [
        { name: { [Op.iLike]: term } },
        { email: { [Op.iLike]: term } },
        { phone: { [Op.iLike]: term } },
      ];
    }

    const { rows, count } = await this.models.Users.findAndCountAll({
      where,
      attributes: [...DirectoryService.SAFE_COLUMNS],
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    return { rows, total: count };
  }

  /** One player, same allow-list. */
  async get({ userId, staffId }) {
    const visible = await this.#visibleStaffIds(staffId);

    const where = { id: userId };
    if (!visible.all) where.parent_staff_id = { [Op.in]: visible.ids };

    const user = await this.models.Users.findOne({
      where,
      attributes: [...DirectoryService.SAFE_COLUMNS],
      raw: true,
    });

    // A player outside the caller's tree is reported as missing rather than as
    // forbidden — "forbidden" confirms the id exists.
    if (!user) throw E.NOT_FOUND({ userId });
    return user;
  }

  /**
   * @legacy GET /user-summary
   *
   * Deposits and withdrawals per player. See the class note for why the two
   * sides are aggregated separately.
   */
  async summary({ limit, offset, staffId }) {
    const visible = await this.#visibleStaffIds(staffId);

    const where = visible.all ? {} : { parent_staff_id: { [Op.in]: visible.ids } };

    const { rows: users, count } = await this.models.Users.findAndCountAll({
      where,
      attributes: ['id', 'name', 'email'],
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    if (!users.length) return { rows: [], total: count };

    const ids = users.map((u) => Number(u.id));

    // TWO queries, not one join. Each aggregate is over its own table, so
    // neither can multiply the other.
    const [deposits, withdrawals] = await Promise.all([
      this.#sumBy(this.models.Deposits, ids),
      this.#sumBy(this.models.Withdrawals, ids),
    ]);

    return {
      rows: users.map((user) => {
        const id = Number(user.id);
        return {
          ...user,
          deposits: deposits.get(id) ?? { count: 0, total: '0' },
          withdrawals: withdrawals.get(id) ?? { count: 0, total: '0' },
        };
      }),
      total: count,
    };
  }

  /**
   * Count and total per player for one table.
   *
   * Grouped in the database, so the whole table is never loaded — the legacy
   * report pulled every deposit and every withdrawal row for every user on the
   * page and summed them in the join.
   */
  async #sumBy(model, userIds) {
    if (!model) return new Map();

    const rows = await model.findAll({
      where: { uid: { [Op.in]: userIds } },
      attributes: [
        [col('uid'), 'uid'],
        [fn('COUNT', literal('*')), 'count'],
        [fn('COALESCE', fn('SUM', col('amount')), 0), 'total'],
      ],
      group: ['uid'],
      raw: true,
    });

    return new Map(rows.map((r) => [Number(r.uid), { count: Number(r.count), total: String(r.total) }]));
  }

  /**
   * @legacy DELETE /deleteUser
   *
   * ═══════════════════════════════════════════════════════════════════════
   * THIS DOES NOT DELETE ANYTHING, AND THAT IS THE PORT.
   *
   * The legacy handler was unauthenticated, took `id` from the request body,
   * and then:
   *
   *     SELECT table_name FROM information_schema.tables WHERE table_schema='public'
   *     -- for each table, look for a column named
   *     --   user_id | userid | uid | id_user | user
   *     DELETE FROM "<table>" WHERE "<column>" = $1
   *
   * It enumerated the schema at runtime and deleted from EVERY table with a
   * user-shaped column. That is the ledger, the bets, the deposits, the
   * withdrawals, the KYC record — a player's entire financial history, erased
   * by one unauthenticated DELETE with a number in the body. It also
   * interpolated table and column names straight from `information_schema` into
   * SQL, and it would happily match a `uid` column that means something else
   * entirely in an unrelated table.
   *
   * There is no correct version of this. A regulated operator cannot delete a
   * settled financial record on request, and a support agent closing an account
   * needs a status change, not an erasure. So the route answers 501 and says
   * what to do instead, which is the only outcome that does not quietly leave a
   * data-destruction tool in the API.
   *
   * Closing an account is `PATCH /admin/user/profile/:id` with a status.
   * ═══════════════════════════════════════════════════════════════════════
   */
  async refuseDelete({ userId, actor }) {
    this.logger?.warn(
      { userId, staffId: actor?.id },
      'Refused DELETE /deleteUser — cross-table erasure is not available through the API'
    );
    throw E.DELETE_NOT_SUPPORTED({ userId });
  }

  /**
   * Whose players this operator may see.
   *
   * Resolved by admin-service, which owns `staff`. Same discipline as the
   * casino reports: the id comes from a verified token, never a header.
   */
  async #visibleStaffIds(staffId) {
    const { ids } = await this.clients.admin.get(
      `/internal/admin/staff-directory/staff/${staffId}/descendants`
    );

    const root = Number(this.config.ROOT_STAFF_ID ?? 1);
    if (ids.map(Number).includes(root)) return { all: true, ids: [] };

    return { all: false, ids: ids.map(Number) };
  }
}

module.exports = { DirectoryService, E };
