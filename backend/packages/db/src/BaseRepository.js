'use strict';

const { Op } = require('sequelize');
const { NotFoundError } = require('@ibitplay/common');

/**
 * The modular query layer.
 *
 * Controllers never touch a model directly. Each domain module owns a
 * repository that extends this class, and every query against that table lives
 * in that one file. The payoff is concrete: when a column changes, there is
 * exactly one place to look, and a slow query has one place to be fixed rather
 * than being copy-pasted across six controllers.
 *
 *   class UserRepository extends BaseRepository {
 *     constructor(models) { super(models.Users, { name: 'user' }) }
 *     findByEmail(email, opts) { return this.findOne({ email }, opts) }
 *   }
 *
 * Every method takes an optional `{ transaction }`, so a repository call
 * composes into a caller's transaction rather than opening its own.
 */

class BaseRepository {
  /**
   * @param {import('sequelize').ModelStatic} model
   * @param {object} [options]
   * @param {string} [options.name]           Human name used in NotFound messages.
   * @param {string[]} [options.searchable]   Columns matched by `search` in list().
   * @param {string[]} [options.sortable]     Columns allowed in `sort` — an allowlist,
   *                                          because an unchecked ORDER BY column is
   *                                          both an injection surface and a way to
   *                                          force a sequential scan.
   * @param {string[]} [options.hidden]       Attributes never returned by default.
   */
  constructor(model, { name, searchable = [], sortable = [], hidden = [], defaultSort = null } = {}) {
    if (!model) throw new Error('BaseRepository requires a Sequelize model');
    this.model = model;
    this.name = name || model.name;
    this.searchable = searchable;
    this.sortable = sortable;
    this.hidden = hidden;
    this.defaultSort = defaultSort || [[model.primaryKeyAttribute || 'id', 'DESC']];
    this.primaryKey = model.primaryKeyAttribute || 'id';
  }

  /** Attributes to select, minus anything marked hidden (password hashes, seeds). */
  visibleAttributes(extra = []) {
    if (!this.hidden.length) return undefined; // undefined = all columns
    const all = Object.keys(this.model.rawAttributes);
    return all.filter((attr) => !this.hidden.includes(attr) || extra.includes(attr));
  }

  // ── Reads ────────────────────────────────────────────────────────────

  findByPk(id, { transaction, include, attributes, lock, paranoid } = {}) {
    return this.model.findByPk(id, {
      transaction,
      include,
      lock,
      paranoid,
      attributes: attributes || this.visibleAttributes(),
    });
  }

  /** Same as findByPk but throws a 404 instead of returning null. */
  async findByPkOrFail(id, options = {}) {
    const record = await this.findByPk(id, options);
    if (!record) throw new NotFoundError(`${this.name} ${id} not found`);
    return record;
  }

  findOne(where, { transaction, include, attributes, order, lock } = {}) {
    return this.model.findOne({
      where,
      transaction,
      include,
      order,
      lock,
      attributes: attributes || this.visibleAttributes(),
    });
  }

  async findOneOrFail(where, options = {}) {
    const record = await this.findOne(where, options);
    if (!record) throw new NotFoundError(`${this.name} not found`);
    return record;
  }

  findAll(where = {}, { transaction, include, attributes, order, limit, offset } = {}) {
    return this.model.findAll({
      where,
      transaction,
      include,
      order: order || this.defaultSort,
      limit,
      offset,
      attributes: attributes || this.visibleAttributes(),
    });
  }

  count(where = {}, { transaction, include } = {}) {
    return this.model.count({ where, transaction, include });
  }

  exists(where, { transaction } = {}) {
    return this.model
      .count({ where, transaction, limit: 1 })
      .then((n) => n > 0);
  }

  /**
   * Paginated list with search and sorting.
   *
   * `distinct: true` matters whenever `include` is present — without it a
   * one-to-many join inflates the count and the client sees the wrong total.
   */
  async list({ page = 1, limit = 20, sort, search, filters = {} } = {}, { transaction, include, attributes } = {}) {
    const where = { ...this.buildFilters(filters) };

    if (search && this.searchable.length) {
      where[Op.or] = this.searchable.map((column) => ({ [column]: { [Op.iLike]: `%${search}%` } }));
    }

    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const safePage = Math.max(Number(page) || 1, 1);

    const { rows, count } = await this.model.findAndCountAll({
      where,
      include,
      transaction,
      attributes: attributes || this.visibleAttributes(),
      order: this.buildOrder(sort),
      limit: safeLimit,
      offset: (safePage - 1) * safeLimit,
      distinct: Boolean(include),
    });

    return { rows, count, page: safePage, limit: safeLimit };
  }

  /**
   * "field:asc" -> [['field','ASC']], rejecting anything not on the allowlist.
   * Falls back to the default sort rather than throwing, so a stale bookmark
   * with a removed column still returns results.
   */
  buildOrder(sort) {
    if (!sort) return this.defaultSort;
    const [field, direction = 'asc'] = String(sort).split(':');
    if (!this.sortable.includes(field)) return this.defaultSort;
    return [[field, direction.toLowerCase() === 'desc' ? 'DESC' : 'ASC']];
  }

  /**
   * Translate a plain filter object into a Sequelize `where`.
   * Supported shapes, so callers never hand-write Op symbols:
   *   { status: 'active' }                  -> equality
   *   { status: ['active','locked'] }       -> IN
   *   { balance: { gt: 100 } }              -> >
   *   { created: { between: [from, to] } }  -> BETWEEN
   *   { email: { like: 'a%' } }             -> ILIKE
   *   { deleted_at: null }                  -> IS NULL
   */
  buildFilters(filters = {}) {
    const operators = {
      eq: Op.eq,
      ne: Op.ne,
      gt: Op.gt,
      gte: Op.gte,
      lt: Op.lt,
      lte: Op.lte,
      in: Op.in,
      notIn: Op.notIn,
      like: Op.iLike,
      notLike: Op.notILike,
      between: Op.between,
      notBetween: Op.notBetween,
      is: Op.is,
      not: Op.not,
      contains: Op.contains,
      overlap: Op.overlap,
    };

    const where = {};
    for (const [field, value] of Object.entries(filters)) {
      if (value === undefined) continue;
      // Only real columns — a typo must not silently widen the result set.
      if (!this.model.rawAttributes[field]) continue;

      if (value === null) {
        where[field] = { [Op.is]: null };
      } else if (Array.isArray(value)) {
        where[field] = { [Op.in]: value };
      } else if (typeof value === 'object' && !(value instanceof Date)) {
        const conditions = {};
        for (const [operator, operand] of Object.entries(value)) {
          if (operators[operator] !== undefined && operand !== undefined) {
            conditions[operators[operator]] = operand;
          }
        }
        if (Object.getOwnPropertySymbols(conditions).length) where[field] = conditions;
      } else {
        where[field] = value;
      }
    }
    return where;
  }

  // ── Writes ───────────────────────────────────────────────────────────

  create(values, { transaction, returning = true, fields } = {}) {
    return this.model.create(values, { transaction, returning, fields });
  }

  bulkCreate(rows, { transaction, updateOnDuplicate, ignoreDuplicates, returning = true } = {}) {
    return this.model.bulkCreate(rows, { transaction, updateOnDuplicate, ignoreDuplicates, returning });
  }

  /** Returns [affectedCount, affectedRows]. */
  update(where, values, { transaction, returning = true, fields } = {}) {
    return this.model.update(values, { where, transaction, returning, fields });
  }

  /** Update by primary key, throwing 404 when the row is not there. */
  async updateByPk(id, values, { transaction, fields } = {}) {
    const record = await this.findByPkOrFail(id, { transaction });
    return record.update(values, { transaction, fields });
  }

  destroy(where, { transaction, force = false } = {}) {
    return this.model.destroy({ where, transaction, force });
  }

  /**
   * INSERT ... ON CONFLICT DO UPDATE.
   * `conflictFields` must be covered by a unique index or Postgres rejects it.
   */
  upsert(values, { transaction, conflictFields, returning = true } = {}) {
    return this.model.upsert(values, { transaction, conflictFields, returning });
  }

  /**
   * Atomic increment — `SET column = column + n` in the database rather than
   * read-modify-write in JS. This is the only safe way to bump a counter that
   * concurrent requests touch.
   */
  increment(where, fields, { transaction, by = 1 } = {}) {
    return this.model.increment(fields, { where, transaction, by });
  }

  decrement(where, fields, { transaction, by = 1 } = {}) {
    return this.model.decrement(fields, { where, transaction, by });
  }

  /** Escape hatch for reporting queries that are genuinely clearer as SQL. */
  raw(sql, { replacements, transaction, type } = {}) {
    return this.model.sequelize.query(sql, {
      replacements,
      transaction,
      type: type || this.model.sequelize.QueryTypes.SELECT,
    });
  }
}

module.exports = { BaseRepository, Op };
