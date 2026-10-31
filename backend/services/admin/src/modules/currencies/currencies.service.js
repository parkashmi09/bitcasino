'use strict';

const crypto = require('crypto');

const { entitlements, currencyRegistry, money, isBuiltinCurrency } = require('@ibitplay/common');

const errors = require('./currencies.errors');
const { inspectCoinImage } = require('./coinImage');
const { SiteConfigService, OPERATOR_FLAGS } = require('../site-config/siteConfig.service');

/** Every column but the image bytes — lists never drag the images through the query. */
const LIST_ATTRIBUTES = Object.freeze([
  'code', 'kind', 'decimals', 'builtin', 'owner_enabled', 'site_enabled', 'name', 'symbol', 'sort_order',
  'image_asset', 'image_content_type', 'image_byte_size', 'networks', 'retired', 'managed_by', 'updated_by',
  'usd_rate', 'created_at', 'updated_at',
]);

const OWNER_WRITER = 'owner';

/** Where a browser fetches a coin's image; `v` changes with every upload, so it caches forever. */
const imageUrl = (row) =>
  row.image_asset ? `/api/v1/admin/currencies/${encodeURIComponent(row.code)}/image?v=${encodeURIComponent(row.image_asset)}` : null;

const networksOf = (row) =>
  (Array.isArray(row.networks) ? row.networks : [])
    .filter((n) => n && typeof n.key === 'string')
    .map((n) => ({ key: n.key, name: typeof n.name === 'string' && n.name ? n.name : n.key, enabled: n.enabled !== false }));

/**
 * Whether the owner's plan includes this coin: its own flag (`flags.btc`) and,
 * for a crypto coin, the crypto master (`flags.cryptocoin`). A missing key is
 * entitled, as everywhere in docs/OWNER-PANEL.md.
 */
function ownerAllows(plan, code, kind) {
  const flags = plan?.flags ?? {};
  if (flags[String(code).toLowerCase()] === false) return false;
  if (kind === 'crypto' && flags.cryptocoin === false) return false;
  return true;
}

/**
 * Whether the owner's plan keeps one network of a coin: `flags["usdt:bep20"]` (lower-case
 * `<code>:<key>`), missing = on. Off hides it from players, the site admin and the deposit /
 * withdraw rails; the site admin's own switch only applies to the ones the owner kept.
 */
const ownerNetworkFlag = (code, key) => `${code}:${key}`.toLowerCase();
const ownerKeepsNetwork = (plan, code, key) => plan?.flags?.[ownerNetworkFlag(code, key)] !== false;
/** The owner's network switches in a document, as a comparable string. */
const networkFlagsOf = (doc) =>
  JSON.stringify(Object.entries(doc?.flags ?? {}).filter(([k]) => k.includes(':')).sort());
// The last applied set, per process (each apply builds a new service).
let appliedNetworkFlags = null;

const CODE = /^[A-Z][A-Z0-9]{1,9}$/;
const KINDS = new Set(['fiat', 'crypto', 'points']);
const NETWORK_KEY = /^[A-Za-z0-9_-]{1,20}$/;
const RATE = /^\d{1,15}(\.\d{1,8})?$/;
const cleanText = (value, max) =>
  typeof value === 'string' && value.trim() && value.trim().length <= max && !/[<>\u0000-\u001f\u007f]/.test(value)
    ? value.trim()
    : null;

/**
 * One custom coin definition from the owner's document (`coins[]`), checked
 * again here — the owner panel validates on save, but this is the side that
 * writes the database. Returns the clean definition, or `{ problem }`.
 *
 *   { code, kind, name, symbol?, decimals 0–8, usdRate "> 0, ≤ 8 dp",
 *     networks?: [{ key, name }] (crypto), enabled? (default true) }
 *
 * Decimals stop at 8: the wallet's money arithmetic works in 8-place minor
 * units (`@ibitplay/common/money`), so a ninth place could never be moved.
 */
function cleanCoinDefinition(raw) {
  if (!raw || typeof raw !== 'object') return { problem: 'not an object' };
  const code = typeof raw.code === 'string' ? raw.code.trim() : '';
  if (!CODE.test(code)) return { problem: 'bad code' };
  if (isBuiltinCurrency(code)) return { code, problem: 'a built-in coin cannot be defined by the owner' };
  if (!KINDS.has(raw.kind)) return { code, problem: 'bad kind' };
  const name = cleanText(raw.name, 60);
  if (!name) return { code, problem: 'bad name' };
  const symbol = raw.symbol === undefined || raw.symbol === '' ? code : cleanText(raw.symbol, 12);
  if (!symbol) return { code, problem: 'bad symbol' };
  const decimals = raw.decimals === undefined ? 8 : raw.decimals;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 8) return { code, problem: 'decimals must be 0–8' };
  const usdRate = typeof raw.usdRate === 'number' ? String(raw.usdRate) : raw.usdRate;
  if (typeof usdRate !== 'string' || !RATE.test(usdRate) || !money.gt(usdRate, '0')) return { code, problem: 'usdRate must be a decimal > 0 with at most 8 places' };
  const networks = [];
  if (raw.kind === 'crypto' && Array.isArray(raw.networks)) {
    for (const n of raw.networks.slice(0, 20)) {
      const key = typeof n?.key === 'string' ? n.key.trim() : '';
      if (!NETWORK_KEY.test(key) || networks.some((x) => x.key === key)) continue;
      networks.push({ key, name: cleanText(n.name, 40) ?? key });
    }
  }
  return { coin: { code, kind: raw.kind, name, symbol, decimals, usdRate: money.fromStored(usdRate), networks, enabled: raw.enabled !== false } };
}

/**
 * The coin registry (migration 061). See `index.js` for the routes and
 * `@ibitplay/common/currencyRegistry` for how other services read it.
 */
class CurrenciesService {
  constructor({ models, logger, config, clients = null }) {
    this.models = models;
    this.logger = logger;
    this.config = config;
    this.clients = clients;
    this.siteConfig = new SiteConfigService({ models, logger, config, clients });
  }

  ownerManaged() {
    return Boolean(this.config?.OWNER_SHARED_SECRET);
  }

  async #rows() {
    return this.models.Currency.findAll({
      attributes: [...LIST_ATTRIBUTES],
      order: [['sort_order', 'ASC'], ['code', 'ASC']],
      raw: true,
    });
  }

  /** One row (without image bytes), or 404. */
  async #row(code) {
    const row = await this.models.Currency.findByPk(code, { attributes: [...LIST_ATTRIBUTES], raw: true });
    if (!row) throw errors.NOT_FOUND({ code });
    return row;
  }

  #serialise(row, plan) {
    // The live plan AND the applied column: right before the store's apply
    // has run, and right after an apply when the cached plan is a beat old.
    const ownerEnabled = Boolean(row.owner_enabled) && ownerAllows(plan, row.code, row.kind);
    const siteEnabled = Boolean(row.site_enabled);
    return {
      code: row.code,
      kind: row.kind,
      decimals: Number(row.decimals),
      builtin: Boolean(row.builtin),
      retired: Boolean(row.retired),
      name: row.name,
      symbol: row.symbol,
      sortOrder: Number(row.sort_order),
      networks: networksOf(row).filter((n) => ownerKeepsNetwork(plan, row.code, n.key)),
      // The owner's fixed USD rate (custom coins, migration 065); null for built-in coins.
      usdRate: row.usd_rate != null ? money.fromStored(row.usd_rate) : null,
      ownerEnabled,
      siteEnabled,
      enabled: ownerEnabled && siteEnabled && !row.retired,
      image: imageUrl(row),
      imageVersion: row.image_asset ?? null,
      imageContentType: row.image_content_type ?? null,
      managedBy: row.managed_by ?? (this.ownerManaged() ? OWNER_WRITER : null),
      updatedBy: row.updated_by ?? null,
      updatedAt: row.updated_at ?? null,
    };
  }

  /** Staff (and the internal registry): every coin with its effective state. */
  async list() {
    const [rows, plan] = await Promise.all([this.#rows(), entitlements.getEntitlements()]);
    return rows.map((row) => this.#serialise(row, plan));
  }

  /** One coin, staff shape. */
  async get(code) {
    const [row, plan] = await Promise.all([this.#row(code), entitlements.getEntitlements()]);
    return this.#serialise(row, plan);
  }

  /**
   * Players: the coins they may use, in the site's order — enabled coins only,
   * each with its enabled networks only. Nothing about switches or the owner.
   */
  async publicList() {
    return (await this.list())
      .filter((c) => c.enabled)
      .map((c) => ({
        code: c.code,
        name: c.name,
        symbol: c.symbol,
        decimals: c.decimals,
        kind: c.kind,
        image: c.image,
        networks: c.networks.filter((n) => n.enabled).map(({ key, name }) => ({ key, name })),
        sort: c.sortOrder,
      }));
  }

  /**
   * For the owner panel's Coins screen (`x-owner-key`): every coin, what it is
   * called on the site and whether the site has it on. Never a secret.
   */
  async ownerList() {
    const [rows, plan] = await Promise.all([this.#rows(), entitlements.getEntitlements()]);
    // Every network, the ones the owner switched off included — the owner panel switches them back on.
    return rows.map((row) => ({ c: this.#serialise(row, plan), networks: networksOf(row) })).map(({ c, networks }) => ({
      code: c.code,
      kind: c.kind,
      name: c.name,
      symbol: c.symbol,
      builtin: c.builtin,
      retired: c.retired,
      decimals: c.decimals,
      usdRate: c.usdRate,
      image: c.image,
      ownerEnabled: c.ownerEnabled,
      siteEnabled: c.siteEnabled,
      networks: networks.map(({ key, name }) => ({ key, name })),
    }));
  }

  /**
   * The site admin's edit. The validator is the allow-list (name, symbol,
   * sortOrder, enabled, networks[{key,name,enabled}]); here:
   *   - switching ON needs the owner's plan → 403 NOT_ENTITLED, and a retired
   *     coin never comes back → 409 CURRENCIES_RETIRED; OFF is always allowed;
   *   - a network is named by its existing key: keys are the contract a
   *     deposit or withdrawal carries, so they are never added, removed or
   *     renamed here (400 CURRENCIES_UNKNOWN_NETWORK);
   *   - `enabled` mirrors into the `siteconfig.<code>` flag column, so the
   *     Feature flags screen and this one never disagree.
   */
  async update({ code, patch, staff }) {
    const row = await this.#row(code);
    const plan = await entitlements.getEntitlements();
    const before = this.#serialise(row, plan);

    const changes = {};
    if (patch.name !== undefined && patch.name !== row.name) changes.name = patch.name;
    if (patch.symbol !== undefined && patch.symbol !== row.symbol) changes.symbol = patch.symbol;
    if (patch.sortOrder !== undefined && patch.sortOrder !== Number(row.sort_order)) changes.sort_order = patch.sortOrder;

    if (patch.enabled === true) {
      if (row.retired) throw errors.RETIRED({ code: row.code });
      if (!before.ownerEnabled) throw entitlements.entitlementErrors.ENTITLED({ kind: 'currency', key: row.code });
    }
    if (patch.enabled !== undefined && patch.enabled !== Boolean(row.site_enabled)) changes.site_enabled = patch.enabled;

    if (patch.networks) {
      const current = networksOf(row);
      const unknown = patch.networks.find((n) => !current.some((c) => c.key === n.key));
      if (unknown) throw errors.UNKNOWN_NETWORK({ code: row.code, key: unknown.key, known: current.map((c) => c.key) });
      const next = current.map((c) => {
        const p = patch.networks.find((n) => n.key === c.key);
        return p ? { key: c.key, name: p.name ?? c.name, enabled: p.enabled ?? c.enabled } : c;
      });
      if (JSON.stringify(next) !== JSON.stringify(current)) changes.networks = next;
    }

    if (!Object.keys(changes).length) return before;

    await this.models.Currency.update(
      { ...changes, updated_by: staff?.id != null ? `staff:${staff.id}` : 'staff' },
      { where: { code: row.code } }
    );

    if (changes.site_enabled !== undefined) await this.#mirrorSiteFlag(row.code, changes.site_enabled);

    this.logger?.warn({ staffId: staff?.id ?? null, code: row.code, changed: Object.keys(changes) }, 'Coin updated');
    await this.changed({ flags: changes.site_enabled !== undefined });
    return this.get(row.code);
  }

  /** `siteconfig.<code>` follows the coin's site switch (when the column exists). */
  async #mirrorSiteFlag(code, enabled) {
    const column = code.toLowerCase();
    if (!OPERATOR_FLAGS.includes(column) || !this.models.Siteconfig) return;
    const cfg = await this.models.Siteconfig.findOne({ attributes: ['id'], order: [['id', 'ASC']], raw: true });
    if (cfg) await this.models.Siteconfig.update({ [column]: enabled, updatedat: new Date() }, { where: { id: cfg.id } });
  }

  /** Replace a coin's image. The bytes are inspected before anything is written. */
  async setImage({ code, file, staff }) {
    const row = await this.#row(code);
    const image = inspectCoinImage(file);
    const hash = crypto.createHash('sha256').update(image.data).digest('hex').slice(0, 12);
    await this.models.Currency.update(
      {
        image_data: image.data,
        image_content_type: image.contentType,
        image_byte_size: image.byteSize,
        image_asset: `${row.code.toLowerCase()}-${hash}${image.extension}`,
        updated_by: staff?.id != null ? `staff:${staff.id}` : 'staff',
      },
      { where: { code: row.code } }
    );
    this.logger?.warn({ staffId: staff?.id ?? null, code: row.code, bytes: image.byteSize, contentType: image.contentType }, 'Coin image replaced');
    await this.changed();
    return this.get(row.code);
  }

  /** The image bytes for the public route. */
  async imageBytes(code) {
    const row = await this.models.Currency.findByPk(code, {
      attributes: ['code', 'image_data', 'image_content_type', 'image_byte_size', 'image_asset', 'updated_at'],
      raw: true,
    });
    if (!row) throw errors.NOT_FOUND({ code });
    if (!row.image_data) throw errors.NO_IMAGE({ code });
    const data = Buffer.from(row.image_data);
    return {
      data,
      contentType: row.image_content_type || 'application/octet-stream',
      byteSize: row.image_byte_size ?? data.length,
      version: row.image_asset,
      updatedAt: row.updated_at,
    };
  }

  /**
   * The owner's document → the registry. Run by FeaturesService.applyOwner at
   * boot and on every new entitlement version; idempotent, only rows that
   * differ are written.
   *
   *   1. `coins[]` (custom coins, phase B, migration 065): a code the registry
   *      lacks is INSERTED (`builtin = false`, site switch on, owner's name,
   *      symbol, kind, decimals, networks, USD rate). An existing custom row
   *      gets the OWNER's columns only — kind, decimals, rate, network KEYS
   *      (a kept key keeps the site's name and switch) — never the name,
   *      symbol, image or site switch the site admin may have changed. A
   *      built-in code is never written from `coins[]`. Nothing is deleted:
   *      a custom coin the document no longer lists, or lists with
   *      `enabled: false`, is switched off (`owner_enabled = false`).
   *      The rate also goes to `exchangerate` (tagged `managed_by = 'owner'`)
   *      so swap and convert price the coin like any other.
   *   2. every row → `owner_enabled` from the per-coin flags (+ the crypto
   *      master), AND, for a custom coin, its definition's `enabled`.
   *
   * The built-in default (`source: 'default'`, no owner document reachable)
   * leaves custom coins exactly as they are.
   */
  async applyOwnerDocument(doc) {
    if (!this.models.Currency) return null;
    const managed = Boolean(doc) && doc.source !== 'default';
    const custom = managed ? await this.#applyCustomCoins(doc) : { definitions: null, created: [], updated: [] };

    const rows = await this.#rows();
    const switched = [];
    for (const row of rows) {
      let want = ownerAllows(doc, row.code, row.kind);
      if (!row.builtin && custom.definitions) want = want && custom.definitions.get(row.code)?.enabled === true;
      if (!row.builtin && !custom.definitions) want = Boolean(row.owner_enabled);
      const managedBy = managed ? OWNER_WRITER : row.managed_by;
      if (Boolean(row.owner_enabled) === want && row.managed_by === managedBy) continue;
      await this.models.Currency.update({ owner_enabled: want, managed_by: managedBy }, { where: { code: row.code } });
      if (Boolean(row.owner_enabled) !== want) switched.push({ code: row.code, ownerEnabled: want });
    }
    // A network switch moves no row (it is read from the plan), so it is noticed here.
    const networkFlags = networkFlagsOf(doc);
    const networksMoved = networkFlags !== appliedNetworkFlags;
    appliedNetworkFlags = networkFlags;
    if (switched.length || custom.created.length || custom.updated.length || networksMoved) {
      this.logger?.warn({ version: doc?.version, switched, created: custom.created, updated: custom.updated, networksMoved }, 'Owner document applied to coins');
      await this.changed();
    }
    return { switched, created: custom.created, updated: custom.updated };
  }

  /** Step 1 of `applyOwnerDocument`. Returns the clean definitions by code. */
  async #applyCustomCoins(doc) {
    const definitions = new Map();
    const created = [];
    const updated = [];
    const list = Array.isArray(doc.coins) ? doc.coins.slice(0, 200) : [];

    for (const raw of list) {
      const { coin, code, problem } = cleanCoinDefinition(raw);
      if (problem) {
        this.logger?.warn({ code: code ?? null, problem, version: doc.version }, 'Owner coin definition refused');
        continue;
      }
      if (!definitions.has(coin.code)) definitions.set(coin.code, coin);
    }
    if (!definitions.size) return { definitions, created, updated };

    const existing = new Map(
      (await this.models.Currency.findAll({ attributes: [...LIST_ATTRIBUTES], raw: true })).map((r) => [r.code, r])
    );
    let nextSort = Math.max(0, ...[...existing.values()].map((r) => Number(r.sort_order) || 0)) + 10;

    for (const coin of definitions.values()) {
      const row = existing.get(coin.code);
      if (row?.builtin) {
        // A built-in coin is switched through `flags`, never redefined.
        this.logger?.warn({ code: coin.code }, 'Owner coin definition names a built-in coin — ignored');
        definitions.delete(coin.code);
        continue;
      }
      if (!row) {
        await this.models.Currency.create({
          code: coin.code,
          kind: coin.kind,
          decimals: coin.decimals,
          builtin: false,
          owner_enabled: coin.enabled,
          site_enabled: true,
          name: coin.name,
          symbol: coin.symbol,
          sort_order: nextSort,
          networks: coin.networks.map((n) => ({ ...n, enabled: true })),
          retired: false,
          usd_rate: coin.usdRate,
          managed_by: OWNER_WRITER,
          updated_by: OWNER_WRITER,
        });
        nextSort += 10;
        created.push(coin.code);
      } else {
        const changes = {};
        if (row.kind !== coin.kind) changes.kind = coin.kind;
        if (Number(row.decimals) !== coin.decimals) changes.decimals = coin.decimals;
        if (row.usd_rate == null || money.fromStored(row.usd_rate) !== coin.usdRate) changes.usd_rate = coin.usdRate;
        // Keys are the owner's; a kept key keeps the site's display name and switch.
        const current = networksOf(row);
        const nextNetworks = coin.networks.map((n) => current.find((c) => c.key === n.key) ?? { ...n, enabled: true });
        if (JSON.stringify(nextNetworks) !== JSON.stringify(current)) changes.networks = nextNetworks;
        if (Object.keys(changes).length) {
          await this.models.Currency.update({ ...changes, updated_by: OWNER_WRITER }, { where: { code: coin.code, builtin: false } });
          updated.push(coin.code);
        }
      }
      await this.#applyOwnerRate(coin.code, coin.usdRate);
    }
    return { definitions, created, updated };
  }

  /** The owner's fixed rate → `exchangerate` (one row per code, `managed_by = 'owner'`). */
  async #applyOwnerRate(code, usdRate) {
    const { sequelize } = this.models.Currency;
    const { QueryTypes } = sequelize.constructor;
    const rows = await sequelize.query(
      'SELECT id, usd_rate, managed_by FROM exchangerate WHERE UPPER(currency) = :code ORDER BY id ASC',
      { replacements: { code }, type: QueryTypes.SELECT }
    );
    if (!rows.length) {
      await sequelize.query(
        `INSERT INTO exchangerate (currency, usd_rate, last_updated, managed_by) VALUES (:code, :usdRate, CURRENT_TIMESTAMP, :owner)`,
        { replacements: { code, usdRate, owner: OWNER_WRITER } }
      );
      return;
    }
    const row = rows[0];
    if (money.fromStored(row.usd_rate ?? '0') === usdRate && row.managed_by === OWNER_WRITER) return;
    await sequelize.query(
      'UPDATE exchangerate SET usd_rate = :usdRate, last_updated = CURRENT_TIMESTAMP, managed_by = :owner WHERE id = :id',
      { replacements: { id: row.id, usdRate, owner: OWNER_WRITER } }
    );
  }

  /**
   * After any change: drop the cached registry here, then push the public
   * list down the player sockets (`currenciesUpdated`, through user-service,
   * which also drops its cached copy) — with the flags when a site switch moved.
   */
  async changed({ flags = false } = {}) {
    currencyRegistry.invalidateCurrencyRegistry();
    const currencies = await this.publicList();
    if (flags) return this.siteConfig.pushPublic({ currencies });
    const client = this.clients?.user;
    if (!client) return { pushed: false };
    try {
      await client.post('/internal/user/preferences/site-config', { currencies });
      return { pushed: true };
    } catch (error) {
      this.logger?.warn({ err: error.message }, 'Could not push the coin list to the player sockets');
      return { pushed: false };
    }
  }

  /**
   * A `siteconfig` coin flag changed on the Feature flags screen: mirror it
   * into `site_enabled` (the other direction of #mirrorSiteFlag). Returns the
   * codes it changed.
   */
  async syncSiteFlags(flags) {
    if (!this.models.Currency) return [];
    const changed = [];
    for (const [name, value] of Object.entries(flags ?? {})) {
      if (typeof value !== 'boolean') continue;
      const code = name.toUpperCase();
      if (!/^[A-Z][A-Z0-9]{1,9}$/.test(code)) continue;
      const [count] = await this.models.Currency.update(
        { site_enabled: value },
        { where: { code, site_enabled: !value } }
      );
      if (count) changed.push(code);
    }
    if (changed.length) currencyRegistry.invalidateCurrencyRegistry();
    return changed;
  }
}

module.exports = { CurrenciesService, ownerAllows, ownerKeepsNetwork, cleanCoinDefinition };
