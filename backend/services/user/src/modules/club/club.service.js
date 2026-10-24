'use strict';

const crypto = require('crypto');

const { Op, fn, col } = require('sequelize');
const { money } = require('@ibitplay/common');

const errors = require('./club.errors');
const { ROLE, ROLE_TRANSITIONS, CODE_ALPHABET, CODE_LENGTH, EARNINGS_TYPES } = require('./club.constants');

/**
 * Clubs — an owner, their agents, and the members those agents recruit.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE FEATURE HAS NEVER WORKED
 *
 * `legacy/clubmembership/` is mounted and its controller references
 * `club_memberships` fourteen times. That table did not exist. Neither did
 * `club_earnings_log`. Every membership endpoint — join, change role, count
 * members, delete club — has been returning "relation does not exist" on every
 * call since deployment. Both tables are created by migration 014, from the
 * column lists the legacy queries name.
 *
 * On top of that, `joinClub` and `changeUserRole` both end with:
 *
 *     } finally {
 *       client.release();          ← `client` is never declared in either
 *     }                              function
 *
 * a ReferenceError on every call, including the success path, thrown after the
 * response has been sent. So even with the tables in place, both endpoints
 * would have raised an unhandled rejection every time they ran.
 *
 * ── AND ANYONE COULD PROMOTE ANYONE ──────────────────────────────────────
 * `changeUserRole` took `userId`, `clubId` and `newRole` from the request body
 * on an unauthenticated route. Promoting yourself to `agent` mints a
 * recruitment code and puts you in the earnings hierarchy. Here a role change
 * is an OWNER action, checked against the club the caller actually owns.
 * ─────────────────────────────────────────────────────────────────────────
 */
class ClubService {
  constructor({ models, db, logger, config }) {
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.config = config;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Clubs
  // ══════════════════════════════════════════════════════════════════════

  /** @legacy POST /clubmembership/create */
  async create({ ownerId, name, description, maxMembers, parentClubId, profilePicture }) {
    const owner = await this.models.Users.findByPk(ownerId, { attributes: ['id', 'name'], raw: true });
    if (!owner) throw errors.USER_NOT_FOUND({ ownerId });

    // A player belongs to one club, owner or not — so someone who is already a
    // member cannot found a second one and sit in two earnings hierarchies.
    const existing = await this.models.ClubMembership.findOne({ where: { user_id: ownerId }, raw: true });
    if (existing) throw errors.ALREADY_IN_CLUB({ clubId: existing.club_id, role: existing.role });

    return this.db.transaction(async (transaction) => {
      const club = await this.models.Clubs.create(
        {
          name,
          owner_id: ownerId,
          description: description ?? null,
          max_members: maxMembers ?? null,
          parent_club_id: parentClubId ?? null,
          profile_picture: profilePicture ?? null,
          is_active: true,
          unique_club_id: await this.#uniqueCode('club', transaction),
        },
        { transaction }
      );

      // The owner is a member of their own club. Legacy inserted this row with
      // a DIFFERENT column list from the member path, which is why
      // `unique_agent_code` and `agent_id` are nullable.
      await this.models.ClubMembership.create(
        {
          user_id: ownerId,
          club_id: club.id,
          role: ROLE.OWNER,
          unique_agent_code: await this.#uniqueCode('agent', transaction),
          joined_at: new Date(),
        },
        { transaction }
      );

      // The closure table. A club is its own ancestor at depth 0 — without that
      // row, "every club at or below X" misses X itself.
      await this.#linkHierarchy(club.id, parentClubId, transaction);

      this.logger?.info({ clubId: club.id, ownerId, name }, 'Club created');
      return this.#shapeClub(club.get({ plain: true }));
    });
  }

  /** @legacy PUT /clubmembership/update */
  async update({ clubId, actorId, ...patch }) {
    const club = await this.#ownedClub(clubId, actorId);

    const changes = {};
    for (const [key, column] of Object.entries({
      name: 'name',
      description: 'description',
      maxMembers: 'max_members',
      profilePicture: 'profile_picture',
      isActive: 'is_active',
    })) {
      if (patch[key] !== undefined) changes[column] = patch[key];
    }

    if (!Object.keys(changes).length) return this.#shapeClub(club);

    await this.models.Clubs.update(changes, { where: { id: clubId } });
    const updated = await this.models.Clubs.findByPk(clubId, { raw: true });
    return this.#shapeClub(updated);
  }

  /**
   * @legacy DELETE /clubmembership/:clubId/delete
   *
   * Legacy deleted the memberships and then the club, in two statements with no
   * transaction — a failure between them left members pointing at a club that
   * no longer existed.
   */
  async remove({ clubId, actorId }) {
    await this.#ownedClub(clubId, actorId);

    return this.db.transaction(async (transaction) => {
      const children = await this.models.Clubs.count({ where: { parent_club_id: clubId }, transaction });
      if (children > 0) throw errors.HAS_SUB_CLUBS({ clubId, children });

      await this.models.ClubMembership.destroy({ where: { club_id: clubId }, transaction });
      await this.models.ClubHierarchy.destroy({
        where: { [Op.or]: [{ ancestor_id: clubId }, { descendant_id: clubId }] },
        transaction,
      });
      await this.models.Clubs.destroy({ where: { id: clubId }, transaction });

      this.logger?.info({ clubId, actorId }, 'Club deleted');
      return { clubId, deleted: true };
    });
  }

  /** @legacy GET /clubmembership/profile/:clubId */
  async getClub({ clubId }) {
    const club = await this.models.Clubs.findOne({
      where: { [Op.or]: [{ id: this.#numericOrNull(clubId) ?? -1 }, { unique_club_id: String(clubId) }] },
      raw: true,
    });
    if (!club) throw errors.CLUB_NOT_FOUND({ clubId });

    const members = await this.models.ClubMembership.count({ where: { club_id: club.id } });
    return { ...this.#shapeClub(club), members };
  }

  /** @legacy GET /clubmembership/:clubId/hierarchy */
  async hierarchy({ clubId }) {
    const club = await this.models.Clubs.findByPk(clubId, { raw: true });
    if (!club) throw errors.CLUB_NOT_FOUND({ clubId });

    const links = await this.models.ClubHierarchy.findAll({
      where: { ancestor_id: clubId },
      order: [['depth', 'ASC']],
      raw: true,
    });

    const ids = links.map((l) => l.descendant_id);
    const clubs = ids.length
      ? await this.models.Clubs.findAll({ where: { id: ids }, raw: true })
      : [];
    const byId = new Map(clubs.map((c) => [String(c.id), c]));

    return links
      .map((l) => {
        const node = byId.get(String(l.descendant_id));
        return node ? { ...this.#shapeClub(node), depth: l.depth } : null;
      })
      .filter(Boolean);
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Membership
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy POST /clubmembership/join
   *
   * Join by club code or by an agent's recruitment code.
   *
   * The player is the authenticated caller. Legacy took `userId` from the body,
   * so anyone could put anyone into any club — and being in a club determines
   * who earns commission on that player's wagering.
   */
  async join({ userId, clubCode, agentCode }) {
    if (!clubCode && !agentCode) throw errors.CODE_REQUIRED();

    let clubId = null;
    let agentId = null;

    if (agentCode) {
      const agent = await this.models.ClubMembership.findOne({
        where: { unique_agent_code: agentCode, role: [ROLE.AGENT, ROLE.OWNER] },
        raw: true,
      });
      if (!agent) throw errors.AGENT_NOT_FOUND({ agentCode });
      clubId = agent.club_id;
      agentId = agent.user_id;
    } else {
      const club = await this.models.Clubs.findOne({ where: { unique_club_id: clubCode }, raw: true });
      if (!club) throw errors.CLUB_NOT_FOUND({ clubCode });
      if (!club.is_active) throw errors.CLUB_INACTIVE({ clubId: club.id });
      clubId = club.id;
    }

    const club = await this.models.Clubs.findByPk(clubId, { raw: true });
    if (!club) throw errors.CLUB_NOT_FOUND({ clubId });

    // A player recruited by themselves would earn their own commission.
    if (agentId != null && Number(agentId) === Number(userId)) throw errors.CANNOT_RECRUIT_SELF();

    return this.db.transaction(async (transaction) => {
      /**
       * Capacity, checked inside the transaction.
       *
       * Legacy counted members in one statement and inserted in another with
       * nothing serialising them, so a club at its limit accepted as many
       * simultaneous joins as arrived at once.
       */
      if (club.max_members != null) {
        const current = await this.models.ClubMembership.count({
          where: { club_id: clubId, role: { [Op.ne]: ROLE.OWNER } },
          transaction,
        });
        if (current >= Number(club.max_members)) throw errors.CLUB_FULL({ clubId, maxMembers: club.max_members });
      }

      try {
        const membership = await this.models.ClubMembership.create(
          {
            user_id: userId,
            club_id: clubId,
            role: ROLE.MEMBER,
            agent_id: agentId,
            parent_club_id: club.parent_club_id ?? clubId,
            joined_at: new Date(),
          },
          { transaction }
        );

        this.logger?.info({ userId, clubId, agentId }, 'Joined club');
        return this.#shapeMembership(membership.get({ plain: true }));
      } catch (error) {
        // The unique index on user_id is what actually decides this — the
        // legacy "already a member?" check was a read that a concurrent
        // request could pass at the same time.
        if (error?.name === 'SequelizeUniqueConstraintError') throw errors.ALREADY_IN_CLUB({ clubId });
        throw error;
      }
    });
  }

  /** Leave the club the caller is in. Owners cannot leave their own club. */
  async leave({ userId }) {
    const membership = await this.models.ClubMembership.findOne({ where: { user_id: userId }, raw: true });
    if (!membership) throw errors.NOT_A_MEMBER({ userId });
    if (membership.role === ROLE.OWNER) throw errors.OWNER_CANNOT_LEAVE({ clubId: membership.club_id });

    await this.models.ClubMembership.destroy({ where: { id: membership.id } });
    return { clubId: membership.club_id, left: true };
  }

  /**
   * @legacy POST /clubmembership/change-role
   *
   * Promote a member to agent, or demote one back.
   *
   * An OWNER action, and the owner must own the club the member is in.
   * Legacy took every field from the body on an unauthenticated route, so a
   * player could promote themselves to agent — which mints a recruitment code
   * and puts them in the earnings hierarchy.
   */
  async changeRole({ actorId, userId, newRole }) {
    const membership = await this.models.ClubMembership.findOne({ where: { user_id: userId }, raw: true });
    if (!membership) throw errors.NOT_A_MEMBER({ userId });

    await this.#ownedClub(membership.club_id, actorId);

    const allowed = ROLE_TRANSITIONS[membership.role] ?? [];
    if (!allowed.includes(newRole)) {
      throw errors.INVALID_ROLE_CHANGE({ from: membership.role, to: newRole, allowed });
    }

    return this.db.transaction(async (transaction) => {
      // Becoming an agent mints a code; ceasing to be one clears it, so a
      // demoted agent's code stops recruiting immediately.
      const agentCode = newRole === ROLE.AGENT ? await this.#uniqueCode('agent', transaction) : null;

      await this.models.ClubMembership.update(
        { role: newRole, unique_agent_code: agentCode },
        { where: { id: membership.id }, transaction }
      );

      this.logger?.info({ actorId, userId, from: membership.role, to: newRole }, 'Club role changed');
      return { userId, clubId: membership.club_id, role: newRole, agentCode };
    });
  }

  /** @legacy GET /clubmembership/user-affiliations/:userId */
  async myMembership({ userId }) {
    const membership = await this.models.ClubMembership.findOne({ where: { user_id: userId }, raw: true });
    if (!membership) return null;

    const club = await this.models.Clubs.findByPk(membership.club_id, { raw: true });
    return { ...this.#shapeMembership(membership), club: club ? this.#shapeClub(club) : null };
  }

  /** @legacy GET /clubmembership/club_memberships/fetch */
  async listMembers({ clubId, role, limit = 50, offset = 0 }) {
    const { rows, count } = await this.models.ClubMembership.findAndCountAll({
      where: { club_id: clubId, ...(role ? { role } : {}) },
      order: [['joined_at', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    const users = await this.models.Users.findAll({
      where: { id: rows.map((r) => r.user_id) },
      attributes: ['id', 'name', 'level', 'avatar'],
      raw: true,
    });
    const byId = new Map(users.map((u) => [String(u.id), u]));

    return {
      total: count,
      rows: rows.map((r) => ({
        ...this.#shapeMembership(r),
        // Name and level only. The legacy generic fetch returned whole rows.
        user: byId.get(String(r.user_id))
          ? { id: r.user_id, name: byId.get(String(r.user_id)).name, level: byId.get(String(r.user_id)).level }
          : null,
      })),
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Earnings configuration
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy PUT /clubmembership/earnings-config
   *
   * The split between owner, agents and members.
   *
   * The three percentages must not exceed 100 between them. Legacy stored
   * whatever it was given, so a club could be configured to pay out 250% of
   * the wagering it generated.
   */
  async setEarningsConfig({ clubId, actorId, configurationType, ownerPercentage, agentPercentage, memberPercentage, activePlayerThreshold, wagerThreshold }) {
    await this.#ownedClub(clubId, actorId);

    const total = [ownerPercentage, agentPercentage, memberPercentage]
      .filter((v) => v != null)
      .reduce((sum, v) => money.toDecimalString(money.add(sum, String(v))), '0');

    if (money.gt(total, '100')) throw errors.PERCENTAGES_EXCEED_TOTAL({ total });

    const [config] = await this.models.ClubEarningsConfigurations.findOrCreate({
      where: { club_id: clubId, configuration_type: configurationType ?? EARNINGS_TYPES.DEFAULT },
      defaults: {
        club_id: clubId,
        configuration_type: configurationType ?? EARNINGS_TYPES.DEFAULT,
        owner_percentage: ownerPercentage ?? '0',
        agent_percentage: agentPercentage ?? '0',
        member_percentage: memberPercentage ?? '0',
        active_player_threshold: activePlayerThreshold ?? null,
        wager_threshold: wagerThreshold ?? null,
      },
    });

    const patch = {};
    if (ownerPercentage !== undefined) patch.owner_percentage = ownerPercentage;
    if (agentPercentage !== undefined) patch.agent_percentage = agentPercentage;
    if (memberPercentage !== undefined) patch.member_percentage = memberPercentage;
    if (activePlayerThreshold !== undefined) patch.active_player_threshold = activePlayerThreshold;
    if (wagerThreshold !== undefined) patch.wager_threshold = wagerThreshold;

    if (Object.keys(patch).length) {
      await this.models.ClubEarningsConfigurations.update(patch, { where: { id: config.id } });
    }

    const row = await this.models.ClubEarningsConfigurations.findByPk(config.id, { raw: true });
    this.logger?.info({ clubId, actorId, configurationType }, 'Club earnings configuration updated');
    return this.#shapeConfig(row);
  }

  /** @legacy GET /clubmembership/club_earnings_configurations/fetch */
  async earningsConfig({ clubId }) {
    const rows = await this.models.ClubEarningsConfigurations.findAll({
      where: { club_id: clubId },
      raw: true,
    });
    return rows.map((r) => this.#shapeConfig(r));
  }

  /** @legacy GET /clubmembership/club_earnings_log/fetch */
  async earningsLog({ clubId, paid, limit = 50, offset = 0 }) {
    const { rows, count } = await this.models.ClubEarningsLog.findAndCountAll({
      where: { club_id: clubId, ...(paid !== undefined ? { paid } : {}) },
      order: [['created_at', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    return {
      total: count,
      rows: rows.map((r) => ({
        id: r.id,
        beneficiaryId: r.beneficiary_id,
        role: r.beneficiary_role,
        wager: money.toDecimalString(money.toMinor(r.wager_amount ?? '0')),
        percentage: String(r.percentage ?? '0'),
        amount: money.toDecimalString(money.toMinor(r.amount ?? '0')),
        currency: r.currency,
        paid: r.paid,
        createdAt: r.created_at,
      })),
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Staff
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /clubmembership/clubs/fetch
   * @legacy GET /clubmembership/:tableName/fetch
   *
   * ─────────────────────────────────────────────────────────────────────
   * ONE ENDPOINT THAT READ FOUR TABLES BY NAME
   *
   * `/clubmembership/:tableName/fetch` took a table name from the URL, looked
   * it up in a whitelist of four (`clubs`, `club_memberships`,
   * `club_earnings_configurations`, `club_earnings_log`), and built
   * `SELECT * FROM <tableName> WHERE <col> = $n` from whitelisted query
   * parameters. Unauthenticated, and `SELECT *` — so `club_memberships` handed
   * out every agent recruitment code on the platform to anyone who asked.
   *
   * It is replaced by the four typed endpoints that already exist here, each
   * scoped and each returning a shaped row rather than the raw table:
   *
   *     clubs                         → GET /clubs                (this method)
   *     club_memberships              → GET /clubs/:clubId/members
   *     club_earnings_configurations  → GET /clubs/:clubId/earnings-config
   *     club_earnings_log             → GET /clubs/:clubId/earnings
   *
   * ── AND IT CRASHED THE PROCESS ON EVERY CALL ─────────────────────────
   *
   * `fetchData` ends with:
   *
   *     } finally {
   *       if (client) {                ← `client` is never declared in this
   *         await client.release();      function
   *
   * `client` is not a variable in scope, so `if (client)` throws a
   * ReferenceError — from a `finally`, which means it replaces the return value
   * of an async function nothing awaits. An unhandled rejection on every
   * request, success or failure, after the response has already been sent.
   * Node's default for that is to terminate the process.
   *
   * The same bug is in `joinClub`, `changeUserRole` and `deleteClub`. Four
   * copies of one mistake, which is what happens when a function is duplicated
   * rather than shared.
   * ─────────────────────────────────────────────────────────────────────
   */
  async listClubs({ search, ownerId, activeOnly, limit = 50, offset = 0 }) {
    const { rows, count } = await this.models.Clubs.findAndCountAll({
      where: {
        ...(search ? { name: { [Op.iLike]: `%${search}%` } } : {}),
        ...(ownerId ? { owner_id: ownerId } : {}),
        ...(activeOnly ? { is_active: true } : {}),
      },
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    const counts = await this.models.ClubMembership.findAll({
      where: { club_id: rows.map((r) => r.id) },
      attributes: ['club_id', [fn('COUNT', col('id')), 'members']],
      group: ['club_id'],
      raw: true,
    });
    const byClub = new Map(counts.map((c) => [String(c.club_id), Number(c.members)]));

    return {
      total: count,
      rows: rows.map((r) => ({ ...this.#shapeClub(r), members: byClub.get(String(r.id)) ?? 0 })),
    };
  }

  /**
   * @legacy GET /clubmembership/userprofile/:userId
   *
   * The club a player owns, with its member count.
   *
   * ─────────────────────────────────────────────────────────────────────
   * WHAT THE LEGACY VERSION RETURNED, AND WHY IT NEVER WORKED
   *
   * It read the club, counted members, then base64-encoded the profile picture
   * into the JSON response — from a hardcoded absolute path:
   *
   *     path.join('/var/www/html/hellogames/ibitplay/backend/clubmembership/clubprofile',
   *               clubName, profile_picture)
   *
   * That path exists on exactly one machine. Everywhere else the read threw,
   * was caught, and the endpoint answered `profile_picture_data: null,
   * error: 'Image not found'` — which is what production has been returning.
   *
   * `deleteClub` then deleted the picture from a DIFFERENT directory
   * (`../../clubsProfile/<file>`, no club-name segment), so removing a club
   * never removed its image either. Two code paths, two guesses at where the
   * file lives, neither agreeing with the other.
   *
   * Inlining image bytes into a JSON response is dropped rather than
   * reimplemented: it is unbounded — a 20MB upload becomes a 27MB JSON body
   * that cannot be streamed, cached or range-requested — and the legacy
   * `contentType` came from `path.extname()`, so it described the filename
   * rather than the file. The stored name is returned; bytes belong on a route
   * that serves bytes, with containment checks and a magic-byte sniff, as
   * `club-broadcasts` does for banners.
   *
   * `SELECT *` is also dropped. It returned every column of `clubs` to an
   * unauthenticated caller who supplied the `:userId`.
   * ─────────────────────────────────────────────────────────────────────
   */
  async ownerProfile({ ownerId }) {
    const club = await this.models.Clubs.findOne({ where: { owner_id: ownerId }, raw: true });
    if (!club) throw errors.CLUB_NOT_FOUND({ ownerId });

    /**
     * Members excluding the owner, which is what legacy counted
     * (`WHERE club_id = $1 AND role != 'owner'`). Counted by the database
     * rather than by loading the rows — this is a member LIST endpoint away
     * from being a way to page through every club's roster.
     */
    const members = await this.models.ClubMembership.count({
      where: { club_id: club.id, role: { [Op.ne]: ROLE.OWNER } },
    });

    return { ...this.#shapeClub(club), members };
  }

  // ══════════════════════════════════════════════════════════════════════

  /** The club this actor owns, or a refusal. */
  async #ownedClub(clubId, actorId) {
    const club = await this.models.Clubs.findByPk(clubId, { raw: true });
    if (!club) throw errors.CLUB_NOT_FOUND({ clubId });

    // `actorId` null means staff, who act on any club.
    if (actorId != null && Number(club.owner_id) !== Number(actorId)) {
      throw errors.NOT_CLUB_OWNER({ clubId });
    }
    return club;
  }

  /**
   * Maintain the closure table when a club is created.
   *
   * Depth 0 is the club itself. Then every ancestor of the parent becomes an
   * ancestor of this club, one level deeper. Legacy generated club ids but
   * never wrote these rows for a sub-club, so `getClubHierarchy` returned only
   * the club asked about.
   */
  async #linkHierarchy(clubId, parentClubId, transaction) {
    const rows = [{ ancestor_id: clubId, descendant_id: clubId, depth: 0 }];

    if (parentClubId) {
      const ancestors = await this.models.ClubHierarchy.findAll({
        where: { descendant_id: parentClubId },
        raw: true,
        transaction,
      });
      for (const a of ancestors) {
        rows.push({ ancestor_id: a.ancestor_id, descendant_id: clubId, depth: Number(a.depth) + 1 });
      }
    }

    await this.models.ClubHierarchy.bulkCreate(rows, { transaction, ignoreDuplicates: true });
  }

  /**
   * A code nobody can guess and nothing else holds.
   *
   * `crypto.randomInt` rather than `Math.random`: a guessable agent code lets
   * someone attach themselves to an agent's downline, and a guessable club code
   * lets them join a private club.
   *
   * Retried on collision rather than checked-then-inserted — the uniqueness is
   * the database's, and a check leaves a window.
   */
  async #uniqueCode(kind, transaction, attempt = 0) {
    const code = Array.from(
      { length: CODE_LENGTH },
      () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]
    ).join('');

    const taken =
      kind === 'club'
        ? await this.models.Clubs.findOne({ where: { unique_club_id: code }, transaction, raw: true })
        : await this.models.ClubMembership.findOne({ where: { unique_agent_code: code }, transaction, raw: true });

    if (!taken) return code;
    if (attempt >= 5) throw errors.CODE_GENERATION_FAILED({ kind });
    return this.#uniqueCode(kind, transaction, attempt + 1);
  }

  #numericOrNull(value) {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  #shapeClub(club) {
    return {
      id: club.id,
      code: club.unique_club_id,
      name: club.name,
      description: club.description,
      ownerId: club.owner_id,
      parentClubId: club.parent_club_id,
      maxMembers: club.max_members,
      isActive: Boolean(club.is_active),
      profilePicture: club.profile_picture,
      earnings: {
        owner: String(club.owner_earnings_percentage ?? '0'),
        agent: String(club.agent_earnings_percentage ?? '0'),
        member: String(club.member_earnings_percentage ?? '0'),
      },
    };
  }

  #shapeMembership(row) {
    return {
      id: row.id,
      userId: row.user_id,
      clubId: row.club_id,
      role: row.role,
      // Only ever returned to the holder or to staff — the routers decide.
      agentCode: row.unique_agent_code ?? null,
      agentId: row.agent_id ?? null,
      joinedAt: row.joined_at,
    };
  }

  #shapeConfig(row) {
    return {
      id: row.id,
      clubId: row.club_id,
      type: row.configuration_type,
      ownerPercentage: String(row.owner_percentage ?? '0'),
      agentPercentage: String(row.agent_percentage ?? '0'),
      memberPercentage: String(row.member_percentage ?? '0'),
      activePlayerThreshold: row.active_player_threshold,
      wagerThreshold: row.wager_threshold != null ? String(row.wager_threshold) : null,
    };
  }
}

module.exports = { ClubService };
