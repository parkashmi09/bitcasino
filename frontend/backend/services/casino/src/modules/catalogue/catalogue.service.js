'use strict';

const { Op, fn, col, where: sqlWhere } = require('sequelize');

const errors = require('./catalogue.errors');
const { CatalogueClient } = require('./catalogueClient');
const { FEATURED_VENDORS, DEFAULT_PROVIDER } = require('./catalogue.constants');

/**
 * The casino catalogue.
 */
class CatalogueService {
  constructor(deps) {
    this.models = deps.models;
    this.db = deps.db;
    this.logger = deps.logger;
    this.config = deps.config;
    this.client = deps.catalogueClient ?? new CatalogueClient(deps);
  }

  /**
   * @legacy GET /api/games/list
   * @legacy GET /api/gis/games
   * @legacy GET /api/gis/games/provider
   *
   * The local `apigames` catalogue.
   *
   * ─────────────────────────────────────────────────────────────────────
   *     const result = await pg.query('SELECT * FROM apigames');
   *     const filteredGames = games.filter(game =>
   *       (!type || game.type === type) && (!vendor || game.vendor === vendor));
   *
   * Every row of the table into the process on every request, then filtered and
   * grouped in JavaScript. The database does both, and pages.
   * ─────────────────────────────────────────────────────────────────────
   */
  async localGames({ type, vendor, search, limit = 50, offset = 0 }) {
    const where = {
      ...(type ? { type } : {}),
      ...(vendor ? { vendor } : {}),
      ...(search
        ? { title: { [Op.iLike]: `%${String(search).replace(/[\\%_]/g, (c) => `\\${c}`)}%` } }
        : {}),
    };

    const { rows, count } = await this.models.Apigames.findAndCountAll({
      where,
      order: [['vendor', 'ASC'], ['title', 'ASC']],
      limit,
      offset,
      raw: true,
    });

    return { total: count, rows: rows.map((row) => this.#describe(row)) };
  }

  /**
   * @legacy GET /api/gis/providers
   *
   * The vendors present in the local catalogue, with a game count.
   *
   * Legacy derived this by reading every row and reducing in JavaScript; it is
   * a GROUP BY.
   */
  async localVendors() {
    const rows = await this.models.Apigames.findAll({
      attributes: ['vendor', [fn('COUNT', col('id')), 'games']],
      group: ['vendor'],
      order: [['vendor', 'ASC']],
      raw: true,
    });

    return rows
      .filter((row) => row.vendor)
      .map((row) => ({ vendor: row.vendor, games: Number(row.games) || 0 }));
  }

  /**
   * @legacy GET /api/casino/vendors
   *
   * The upstream catalogue, grouped by vendor and type.
   */
  async hubVendors() {
    const games = await this.client.hubGameList();

    const byVendor = new Map();
    for (const game of games) {
      const vendor = game?.vendor;
      if (!vendor) continue;
      if (!byVendor.has(vendor)) byVendor.set(vendor, { vendor, games: 0, types: new Set() });
      const entry = byVendor.get(vendor);
      entry.games += 1;
      if (game.type) entry.types.add(game.type);
    }

    return [...byVendor.values()]
      .map((entry) => ({ vendor: entry.vendor, games: entry.games, types: [...entry.types].sort() }))
      .sort((a, b) => b.games - a.games);
  }

  /** @legacy GET /api/casino/games/list */
  async hubGames({ type, vendor }) {
    const games = await this.client.hubGameList();

    return games
      .filter((game) => (!type || game.type === type) && (!vendor || game.vendor === vendor))
      .map((game) => this.#describeUpstream(game));
  }

  /**
   * @legacy GET /api/casino/games/lists
   *
   * The featured vendors, grouped.
   */
  async hubFeatured() {
    const games = await this.client.hubGameList();
    const featured = new Set(FEATURED_VENDORS);

    const grouped = {};
    for (const game of games) {
      const vendor = String(game?.vendor ?? '').toUpperCase();
      if (!featured.has(vendor)) continue;
      (grouped[vendor] ||= []).push(this.#describeUpstream(game));
    }

    return grouped;
  }

  /** @legacy GET /api/casino/jackpots */
  async jackpots({ currency }) {
    return this.client.hubJackpots(currency);
  }

  /**
   * @legacy GET /game-list
   * @legacy GET /game-list-new
   */
  async nexusGames({ provider = DEFAULT_PROVIDER }) {
    const games = await this.client.nexusGameList(provider);
    return { provider, games: games.map((game) => this.#describeUpstream(game)) };
  }

  /**
   * @legacy POST /game_launch
   * @legacy POST /game_launch_new
   *
   * ─────────────────────────────────────────────────────────────────────
   * THE ACCOUNT COMES FROM THE TOKEN
   *
   *     const { user_code, provider_code, game_code } = req.body;
   *
   * Legacy had no middleware on either route and took the account from the
   * body, so a session could be opened against anyone's balance — the same
   * shape as `/api/casino/gamerun`, against a different aggregator.
   * ─────────────────────────────────────────────────────────────────────
   */
  async launch({ userId, providerCode, gameCode, language }) {
    const player = await this.models.Users.findOne({
      where: { id: userId },
      attributes: ['id', 'name', 'status', 'casino_locked', 'system_locked'],
      raw: true,
    });
    if (!player) throw errors.GAME_NOT_FOUND({ userId });

    // A locked account cannot launch. Legacy checked nothing.
    if (player.system_locked || player.casino_locked || player.status === 'closed') {
      throw errors.PLAYER_LOCKED({ userId });
    }

    const { launchUrl } = await this.client.nexusLaunch({
      /**
       * The aggregator's identifier for the player is their id, not their
       * display name. Legacy passed whatever `user_code` the caller sent.
       */
      userCode: String(player.id),
      providerCode,
      gameCode,
      language,
    });

    this.logger?.info({ userId: String(player.id), providerCode, gameCode }, 'Nexus game launched');
    return { launchUrl };
  }

  /**
   * @legacy POST /update-image
   * @legacy POST /update-gis-images-run-all
   *
   * Copy artwork from `gis_games` onto the `gisgamesnew` rows that match it.
   *
   * ─────────────────────────────────────────────────────────────────────
   * A MAINTENANCE JOB THAT ANYONE COULD RUN
   *
   * Both legacy routes were unauthenticated POSTs that rewrote the artwork
   * across the catalogue every visitor's lobby renders from. `/update-image`
   * did it in one statement over the whole table; `/update-gis-images-run-all`
   * walked it in pages of 50.
   *
   * The join is on the game NAME, lowercased and trimmed:
   *
   *     WHERE lower(trim(g1.name)) = lower(trim(g2.name))
   *
   * Two different games sharing a title across providers — which happens
   * constantly in this industry, "Book of Ra" exists from four vendors — take
   * each other's artwork. `previewOnly` is kept, and REQUIRED to be sent
   * explicitly as false, because the preview is the only thing standing
   * between a typo and the whole lobby's images.
   * ─────────────────────────────────────────────────────────────────────
   */
  async syncImages({ actor, previewOnly = true, limit = 1000 }) {
    /**
     * The matches, always computed — this is the preview, and it is also what
     * gets reported after a real run so the operator can see what moved.
     */
    const matches = await this.models.Gisgamesnew.findAll({
      attributes: ['id', 'name', 'image'],
      limit,
      order: [['id', 'ASC']],
      raw: true,
    });

    const names = matches.map((row) => String(row.name ?? '').trim().toLowerCase()).filter(Boolean);

    const sources = names.length
      ? await this.models.GisGames.findAll({
          where: sqlWhere(fn('LOWER', fn('TRIM', col('name'))), { [Op.in]: names }),
          attributes: ['name', 'image'],
          raw: true,
        })
      : [];

    const imageByName = new Map(
      sources.map((row) => [String(row.name ?? '').trim().toLowerCase(), row.image])
    );

    const pending = matches
      .map((row) => ({
        id: row.id,
        name: row.name,
        currentImage: row.image ?? null,
        newImage: imageByName.get(String(row.name ?? '').trim().toLowerCase()) ?? null,
      }))
      .filter((row) => row.newImage && row.newImage !== row.currentImage);

    if (previewOnly) {
      return { previewOnly: true, wouldUpdate: pending.length, rows: pending.slice(0, 200) };
    }

    let updated = 0;
    await this.db.transaction(async (transaction) => {
      for (const row of pending) {
        const [affected] = await this.models.Gisgamesnew.update(
          { image: row.newImage },
          { where: { id: row.id }, transaction }
        );
        updated += affected;
      }
    });

    this.logger?.warn(
      { actorStaffId: actor?.id, updated, considered: matches.length },
      'Catalogue artwork synced from gis_games'
    );

    return { previewOnly: false, updated, rows: pending.slice(0, 200) };
  }

  // ══════════════════════════════════════════════════════════════════════

  /**
   * A local catalogue row.
   *
   * `apigames` calls the display name `title` and keeps its thumbnail in
   * `details_thumbnails_300x300` — legacy's `/api/games/list` returned
   * `SELECT *` and let the client work that out.
   */
  #describe(row) {
    return {
      id: String(row.id),
      name: row.title ?? null,
      vendor: row.vendor ?? null,
      type: row.type ?? null,
      subtype: row.subtype ?? null,
      platform: row.platform ?? null,
      image: row.details_thumbnails_300x300 ?? null,
      enabled: row.enabled === null || row.enabled === undefined ? null : Boolean(Number(row.enabled)),
      funMode: row.fun_mode === null || row.fun_mode === undefined ? null : Boolean(Number(row.fun_mode)),
    };
  }

  /**
   * An upstream game, reduced to the fields the lobby needs.
   *
   * Legacy forwarded the provider's object verbatim — whatever it contained,
   * including fields that identify the aggregator ACCOUNT rather than the game.
   */
  #describeUpstream(game) {
    return {
      gameCode: game?.game_code ?? game?.gameCode ?? game?.id ?? null,
      name: game?.game_name ?? game?.name ?? null,
      vendor: game?.vendor ?? game?.provider_code ?? null,
      type: game?.type ?? null,
      image: game?.banner ?? game?.image ?? null,
    };
  }
}

module.exports = { CatalogueService };
