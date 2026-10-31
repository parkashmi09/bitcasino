'use strict';

const { QueryTypes } = require('sequelize');
const { entitlements } = require('@ibitplay/common');

const errors = require('./push.errors');
const {
  CAMPAIGN_STATUS: S,
  MAX_CAMPAIGN_PLAYERS,
  TEMPLATE_KINDS,
  TEMPLATE_BY_KIND,
  PROMPT_DEFAULTS,
  SETTINGS_DEFAULTS,
  RECOMMENDED_IMAGE,
  MAX_IMAGE_BYTES,
} = require('./push.constants');
const crypto = require('crypto');

/** What a sound upload really is, by its first bytes (the browser's declared type is not trusted). */
function sniffSound(b) {
  if (b.length < 12) return null;
  if (b.toString('latin1', 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { contentType: 'audio/mpeg', ext: 'mp3' };
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WAVE') return { contentType: 'audio/wav', ext: 'wav' };
  if (b.toString('latin1', 0, 4) === 'OggS') return { contentType: 'audio/ogg', ext: 'ogg' };
  return null;
}
const { render, placeholdersIn } = require('./push.templates');
const { inspectUpload, sizeHints, checkMediaUrl, absoluteUrl, isLocalOrigin, probeImage } = require('./pushImage');
const { buildPayload, MAX_ALIASES } = require('../notifications/providers/onesignal');
const { visibleStaffIds } = require('../staff-directory/staffDirectory.service');
const { FeaturesService } = require('../features/features.service');

/**
 * OneSignal web push, composed by staff: campaigns, notification images,
 * automatic-event templates and the soft-ask prompt copy.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ACCEPTED, NOT DELIVERED
 *
 * OneSignal answers a send with a notification id when it ACCEPTS it and
 * delivers later. `accepted` on a campaign is the number of targeted players
 * in batches OneSignal accepted (by-id sends), or OneSignal's own recipient
 * count / 1 for a segment or tag-filter send. Nothing here claims a device
 * showed the notification.
 *
 * ── WHO A CAMPAIGN MAY REACH ─────────────────────────────────────────────
 *
 * "all" and "players" are resolved against the caller's own tree (the rule
 * the broadcast route follows), and those players also get an inbox row so
 * the bell shows the campaign. Segments, tag filters and the "every
 * subscriber" segment reach whoever OneSignal matches — outside any tree —
 * so only a top-level operator may use them, and they write no inbox rows
 * (the backend cannot know who OneSignal matched).
 *
 * ── SCHEDULING ───────────────────────────────────────────────────────────
 *
 * A scheduled campaign is sent by this service's own scheduler
 * (`push.scheduler.js`), not by OneSignal's `send_after`: the inbox rows have
 * to appear at the same moment, and a cancel must be a local status change.
 * The claim (`UPDATE … WHERE status = 'scheduled' RETURNING`) makes a second
 * process skip a campaign the first has taken.
 * ═════════════════════════════════════════════════════════════════════════
 */
class PushService {
  constructor({ models, logger, config, features, fetchImpl, provider }) {
    this.models = models;
    this.sql = models?.UserNotifications?.sequelize ?? models?.SiteFeature?.sequelize;
    this.logger = logger;
    this.config = config ?? {};
    this.fetchImpl = fetchImpl ?? globalThis.fetch;
    this.features = features ?? (models?.SiteFeature ? new FeaturesService({ models, logger, config, fetchImpl }) : null);
    /** Tests inject a provider (or `null` for "not configured"). */
    this.injectedProvider = provider;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Settings, status
  // ══════════════════════════════════════════════════════════════════════

  async #setting(key) {
    const [row] = await this.sql.query('SELECT value FROM push_settings WHERE key = :key', {
      replacements: { key },
      type: QueryTypes.SELECT,
    });
    return row?.value ?? null;
  }

  async #putSetting(key, value, staffId) {
    await this.sql.query(
      `INSERT INTO push_settings (key, value, updated_by, updated_at) VALUES (:key, CAST(:value AS JSONB), :by, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      { replacements: { key, value: JSON.stringify(value), by: staffId ?? null } }
    );
  }

  async settings() {
    const [prompt, general] = await Promise.all([this.#setting('prompt'), this.#setting('general')]);
    return { prompt: { ...PROMPT_DEFAULTS, ...(prompt ?? {}) }, ...SETTINGS_DEFAULTS, ...(general ?? {}) };
  }

  async saveSettings({ staff, prompt, ...general }) {
    if (prompt) await this.#putSetting('prompt', prompt, staff?.id);
    const keys = Object.keys(general).filter((k) => k in SETTINGS_DEFAULTS);
    if (keys.length) {
      const current = (await this.#setting('general')) ?? {};
      const next = { ...current };
      for (const k of keys) next[k] = k === 'publicOrigin' ? String(general[k]).replace(/\/+$/, '') : general[k];
      await this.#putSetting('general', next, staff?.id);
    }
    return this.settings();
  }

  /** What a player's browser reads: the popup copy and timing, and the chime to play. */
  async publicPrompt() {
    const { prompt, soundUrl } = await this.settings();
    return { ...prompt, soundUrl };
  }

  /** Store an uploaded chime (one per site; a new upload replaces it) and point soundUrl at it. */
  async uploadSound({ staff, file }) {
    if (!file?.buffer?.length) throw errors.SOUND_NO_FILE();
    const kind = sniffSound(file.buffer);
    if (!kind) throw errors.NOT_A_SOUND();
    const tag = crypto.createHash('sha256').update(file.buffer).digest('hex').slice(0, 12);
    await this.#putSetting('sound', { tag, contentType: kind.contentType, data: file.buffer.toString('base64') }, staff?.id);
    return this.saveSettings({ staff, soundUrl: `/api/v1/admin/push/sound/${tag}.${kind.ext}` });
  }

  async soundBytes({ file }) {
    const stored = await this.#setting('sound');
    if (!stored || !file.startsWith(`${stored.tag}.`)) throw errors.SOUND_NOT_FOUND();
    const data = Buffer.from(stored.data, 'base64');
    return { data, contentType: stored.contentType, byteSize: data.length };
  }

  /** Where uploaded images are served from and site paths point: the player site's public origin. */
  async origin(settings) {
    const s = settings ?? (await this.settings());
    const value = s.publicOrigin || this.config.PUBLIC_ASSET_ORIGIN || this.config.PUBLIC_SITE_URL || '';
    return value ? String(value).replace(/\/+$/, '') : null;
  }

  /**
   * The admin status card. Never the key — only whether one is set.
   */
  async status() {
    const settings = await this.settings();
    const row = this.models.SiteFeature
      ? await this.models.SiteFeature.findByPk('push_notifications', { raw: true })
      : null;
    const entitled = await entitlements.isFeatureEntitled('push_notifications').catch(() => true);
    const origin = await this.origin(settings);
    const enabled = Boolean(row?.enabled) && row?.variant === 'onesignal';
    const appId = row?.config?.appId || this.config?.ONESIGNAL_APP_ID || null;
    const apiKeySet = Boolean(row?.secrets?.apiKey || this.config?.ONESIGNAL_API_KEY);
    return {
      entitled,
      enabled,
      variant: row?.variant ?? 'none',
      appIdSet: Boolean(appId),
      appId,
      apiKeySet,
      ready: entitled && enabled && Boolean(appId) && apiKeySet,
      sdkReady: entitled && enabled && Boolean(appId),
      publicOrigin: origin,
      publicOriginSource: settings.publicOrigin ? 'settings' : this.config.PUBLIC_ASSET_ORIGIN ? 'PUBLIC_ASSET_ORIGIN' : this.config.PUBLIC_SITE_URL ? 'PUBLIC_SITE_URL' : null,
      imagesFetchable: Boolean(origin) && !isLocalOrigin(origin) && origin.startsWith('https://'),
      allSegment: settings.allSegment,
      whereToSet: {
        variant: 'Push notifications are not switched on for this site',
        appId: 'Site admin → Site config → Features → Push notifications → OneSignal App ID',
        apiKey: 'Site admin → Site config → Features → Push notifications → App API key (os_v2_…)',
      },
      image: { maxBytes: MAX_IMAGE_BYTES, recommended: RECOMMENDED_IMAGE, formats: ['png', 'jpg', 'webp', 'gif'] },
    };
  }

  /** The OneSignal transport if the site has it switched on with both keys, else null. */
  async provider() {
    if (this.injectedProvider !== undefined) return this.injectedProvider;
    if (!this.features) return null;
    try {
      const p = await this.features.pushProvider();
      if (p) p.allSegment = (await this.settings()).allSegment || p.allSegment;
      return p;
    } catch (error) {
      this.logger?.error({ err: error.message }, 'Could not build the push provider');
      return null;
    }
  }

  async #appId() {
    const row = this.models.SiteFeature ? await this.models.SiteFeature.findByPk('push_notifications', { raw: true }) : null;
    return row?.config?.appId || this.config?.ONESIGNAL_APP_ID || null;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Images
  // ══════════════════════════════════════════════════════════════════════

  #imagePath(row) {
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[row.content_type] ?? 'png';
    return `/api/v1/admin/push/images/${row.id}-${row.tag}.${ext}`;
  }

  async uploadImage({ staff, file }) {
    const img = inspectUpload(file, errors);
    const [row] = await this.sql.query(
      `INSERT INTO push_images (tag, content_type, byte_size, width, height, data, created_by, created_at)
       VALUES (:tag, :contentType, :byteSize, :width, :height, :data, :by, NOW())
       RETURNING id, tag, content_type, byte_size, width, height`,
      {
        replacements: { ...img, by: staff?.id ?? null },
        type: QueryTypes.SELECT,
      }
    );
    const origin = await this.origin();
    const path = this.#imagePath(row);
    const warnings = sizeHints({ width: row.width, height: row.height, byteSize: row.byte_size });
    if (!origin) warnings.push('No public origin is set (Push → Settings, or PUBLIC_ASSET_ORIGIN): the image URL is relative and OneSignal cannot fetch it.');
    else if (isLocalOrigin(origin)) warnings.push(`${origin} is not reachable from OneSignal's servers — the push will arrive without the image until the site runs on a public https domain.`);
    return {
      id: Number(row.id),
      path,
      url: origin ? `${origin}${path}` : path,
      contentType: row.content_type,
      byteSize: row.byte_size,
      width: row.width,
      height: row.height,
      warnings,
    };
  }

  async imageBytes({ file }) {
    const m = /^(\d+)-([0-9a-f]{12})\./.exec(file);
    if (!m) throw errors.IMAGE_NOT_FOUND();
    const [row] = await this.sql.query('SELECT content_type, byte_size, data, created_at FROM push_images WHERE id = :id AND tag = :tag', {
      replacements: { id: m[1], tag: m[2] },
      type: QueryTypes.SELECT,
    });
    if (!row) throw errors.IMAGE_NOT_FOUND();
    return { data: Buffer.from(row.data), contentType: row.content_type, byteSize: row.byte_size, createdAt: row.created_at };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Templates (automatic event pushes)
  // ══════════════════════════════════════════════════════════════════════

  async #templateRows() {
    const rows = await this.sql.query('SELECT * FROM push_templates', { type: QueryTypes.SELECT });
    return new Map(rows.map((r) => [r.kind, r]));
  }

  async listTemplates() {
    const rows = await this.#templateRows();
    return TEMPLATE_KINDS.map((t) => {
      const row = rows.get(t.kind);
      return {
        kind: t.kind,
        group: t.group,
        label: t.label,
        placeholders: t.placeholders,
        defaults: { title: t.title, body: t.body, url: t.url },
        customised: Boolean(row),
        enabled: row ? Boolean(row.enabled) : true,
        title: row?.title ?? t.title,
        body: row?.body ?? t.body,
        imageUrl: row?.image_url ?? null,
        url: row?.url ?? t.url,
        updatedAt: row?.updated_at ?? null,
      };
    });
  }

  async putTemplate({ staff, kind, enabled, title, body, imageUrl, url }) {
    if (!TEMPLATE_BY_KIND.has(kind)) throw errors.TEMPLATE_NOT_FOUND({ kind });
    const warnings = [];
    if (imageUrl) warnings.push(...checkMediaUrl(imageUrl, errors).warnings);
    await this.sql.query(
      `INSERT INTO push_templates (kind, enabled, title, body, image_url, url, updated_by, updated_at)
       VALUES (:kind, :enabled, :title, :body, :imageUrl, :url, :by, NOW())
       ON CONFLICT (kind) DO UPDATE SET enabled = EXCLUDED.enabled, title = EXCLUDED.title, body = EXCLUDED.body,
         image_url = EXCLUDED.image_url, url = EXCLUDED.url, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      { replacements: { kind, enabled, title, body, imageUrl: imageUrl ?? null, url: url ?? null, by: staff?.id ?? null } }
    );
    const tpl = (await this.listTemplates()).find((t) => t.kind === kind);
    return { ...tpl, warnings };
  }

  async resetTemplate({ kind }) {
    if (!TEMPLATE_BY_KIND.has(kind)) throw errors.TEMPLATE_NOT_FOUND({ kind });
    await this.sql.query('DELETE FROM push_templates WHERE kind = :kind', { replacements: { kind } });
    return (await this.listTemplates()).find((t) => t.kind === kind);
  }

  /**
   * The copy for one automatic event (called from notifyPlayer).
   *
   * No operator row → the caller's own words stand (they ARE the defaults)
   * and the click goes to the event's link. A row → its title/body rendered
   * with the event's meta, its image and URL; `push: false` when the operator
   * switched this event's push off (the inbox row is still written).
   */
  async eventContent({ kind, title, body, data }) {
    const meta = data?.meta ?? {};
    let row = null;
    try {
      [row] = await this.sql.query('SELECT * FROM push_templates WHERE kind = :kind', {
        replacements: { kind },
        type: QueryTypes.SELECT,
      });
    } catch (error) {
      // Table missing (migration not yet run) — behave exactly as before.
      this.logger?.warn({ err: error.message }, 'push_templates unreadable; using the built-in copy');
    }
    const origin = await this.origin().catch(() => null);
    const defaultIcon = (await this.settings().catch(() => SETTINGS_DEFAULTS)).defaultIconUrl || null;
    if (!row) {
      return { customised: false, push: true, title, body, imageUrl: null, iconUrl: defaultIcon, url: absoluteUrl(data?.link, origin), template: null };
    }
    const rendered = {
      title: render(row.title, meta).slice(0, 200) || title,
      body: render(row.body, meta) || body,
    };
    // The bell formats {amount} in the player's own style from the raw template,
    // so keep {amount} and fill every other placeholder now.
    const keepAmount = row.body.includes('{amount}') ? row.body.replace(/\{(?!amount\})([a-zA-Z][a-zA-Z0-9_]{0,39})\}/g, (_, k) => render(`{${k}}`, meta)) : null;
    return {
      customised: true,
      push: Boolean(row.enabled),
      ...rendered,
      imageUrl: row.image_url || null,
      iconUrl: defaultIcon,
      url: absoluteUrl(row.url || data?.link, origin),
      link: row.url || data?.link || null,
      template: keepAmount,
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Campaigns
  // ══════════════════════════════════════════════════════════════════════

  #view(r) {
    if (!r) return null;
    return {
      id: Number(r.id),
      name: r.name,
      title: r.title,
      body: r.body,
      imageUrl: r.image_url,
      iconUrl: r.icon_url,
      badgeUrl: r.badge_url,
      url: r.url,
      buttons: r.buttons ?? [],
      data: r.data ?? null,
      priority: r.priority,
      ttlSeconds: r.ttl_seconds,
      topic: r.topic,
      audience: r.audience,
      inbox: Boolean(r.inbox),
      status: r.status,
      sendAt: r.send_at,
      sentAt: r.sent_at,
      cancelledAt: r.cancelled_at,
      onesignalIds: r.onesignal_ids ?? [],
      recipients: r.recipients,
      accepted: r.accepted,
      inboxRows: r.inbox_rows,
      error: r.error,
      createdBy: r.created_by == null ? null : Number(r.created_by),
      createdByName: r.created_by_name ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async #row(id) {
    const [row] = await this.sql.query(
      `SELECT c.*, s.name AS created_by_name FROM push_campaigns c
         LEFT JOIN staff s ON s.id = c.created_by
        WHERE c.id = :id`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );
    if (!row) throw errors.NOT_FOUND({ id });
    return row;
  }

  async listCampaigns({ status, limit = 25, offset = 0 }) {
    const where = status ? 'WHERE status = :status' : '';
    const rows = await this.sql.query(
      `SELECT c.*, s.name AS created_by_name FROM push_campaigns c LEFT JOIN staff s ON s.id = c.created_by
        ${where.replace('status', 'c.status')} ORDER BY c.id DESC LIMIT :limit OFFSET :offset`,
      { replacements: { status, limit, offset }, type: QueryTypes.SELECT }
    );
    const [{ count }] = await this.sql.query(`SELECT COUNT(*)::int AS count FROM push_campaigns ${where}`, {
      replacements: { status },
      type: QueryTypes.SELECT,
    });
    return { rows: rows.map((r) => this.#view(r)), total: count };
  }

  async getCampaign({ id }) {
    return this.#view(await this.#row(id));
  }

  #columns(input) {
    return {
      name: input.name ?? null,
      title: input.title,
      body: input.body,
      image_url: input.imageUrl ?? null,
      icon_url: input.iconUrl ?? null,
      badge_url: input.badgeUrl ?? null,
      url: input.url ?? null,
      buttons: JSON.stringify(input.buttons ?? []),
      data: input.data ? JSON.stringify(input.data) : null,
      priority: input.priority ?? 'normal',
      ttl_seconds: input.ttlSeconds ?? null,
      topic: input.topic ?? null,
      audience: JSON.stringify(input.audience),
      inbox: input.inbox !== false,
      send_at: input.sendAt ? new Date(input.sendAt) : null,
    };
  }

  #checkMedia(input) {
    const warnings = [];
    for (const field of ['imageUrl', 'iconUrl', 'badgeUrl']) {
      if (input[field]) warnings.push(...checkMediaUrl(input[field], errors, field).warnings);
    }
    for (const b of input.buttons ?? []) if (b.icon) warnings.push(...checkMediaUrl(b.icon, errors, `button "${b.text}" icon`).warnings);
    return warnings;
  }

  #assertFuture(sendAt) {
    if (sendAt && new Date(sendAt).getTime() < Date.now() - 30_000) throw errors.SEND_AT_PAST({ sendAt });
  }

  async createCampaign({ staff, ...input }) {
    const warnings = this.#checkMedia(input);
    this.#assertFuture(input.sendAt);
    await this.#assertAudienceAllowed(staff, input.audience);
    const c = this.#columns(input);
    const status = c.send_at ? S.SCHEDULED : S.DRAFT;
    const [row] = await this.sql.query(
      `INSERT INTO push_campaigns (name, title, body, image_url, icon_url, badge_url, url, buttons, data, priority, ttl_seconds,
          topic, audience, inbox, status, send_at, created_by, updated_by, created_at, updated_at)
       VALUES (:name, :title, :body, :image_url, :icon_url, :badge_url, :url, CAST(:buttons AS JSONB), CAST(:data AS JSONB),
          :priority, :ttl_seconds, :topic, CAST(:audience AS JSONB), :inbox, :status, :send_at, :by, :by, NOW(), NOW())
       RETURNING *`,
      { replacements: { ...c, status, by: staff?.id ?? null }, type: QueryTypes.SELECT }
    );
    return { ...this.#view(row), warnings };
  }

  async updateCampaign({ staff, id, ...input }) {
    const current = await this.#row(id);
    if (![S.DRAFT, S.SCHEDULED, S.FAILED].includes(current.status)) throw errors.BAD_STATE({ id, status: current.status });
    const warnings = this.#checkMedia(input);
    this.#assertFuture(input.sendAt);
    await this.#assertAudienceAllowed(staff, input.audience);
    const c = this.#columns(input);
    const status = c.send_at ? S.SCHEDULED : S.DRAFT;
    const [row] = await this.sql.query(
      `UPDATE push_campaigns SET name = :name, title = :title, body = :body, image_url = :image_url, icon_url = :icon_url,
          badge_url = :badge_url, url = :url, buttons = CAST(:buttons AS JSONB), data = CAST(:data AS JSONB), priority = :priority,
          ttl_seconds = :ttl_seconds, topic = :topic, audience = CAST(:audience AS JSONB), inbox = :inbox, status = :status,
          send_at = :send_at, error = NULL, updated_by = :by, updated_at = NOW()
        WHERE id = :id AND status IN ('draft','scheduled','failed')
        RETURNING *`,
      { replacements: { ...c, status, by: staff?.id ?? null, id }, type: QueryTypes.SELECT }
    );
    if (!row) throw errors.BAD_STATE({ id });
    return { ...this.#view(row), warnings };
  }

  async deleteCampaign({ id }) {
    const current = await this.#row(id);
    if (![S.DRAFT, S.CANCELLED, S.FAILED].includes(current.status)) throw errors.BAD_STATE({ id, status: current.status });
    await this.sql.query(`DELETE FROM push_campaigns WHERE id = :id AND status IN ('draft','cancelled','failed')`, {
      replacements: { id },
    });
    return { deleted: true, id: Number(id) };
  }

  async scheduleCampaign({ staff, id, sendAt }) {
    this.#assertFuture(sendAt);
    const [row] = await this.sql.query(
      `UPDATE push_campaigns SET status = 'scheduled', send_at = :sendAt, error = NULL, updated_by = :by, updated_at = NOW()
        WHERE id = :id AND status IN ('draft','scheduled','failed') RETURNING *`,
      { replacements: { id, sendAt: new Date(sendAt), by: staff?.id ?? null }, type: QueryTypes.SELECT }
    );
    if (!row) throw errors.BAD_STATE({ id, status: (await this.#row(id)).status });
    return this.#view(row);
  }

  async cancelCampaign({ staff, id }) {
    const [row] = await this.sql.query(
      `UPDATE push_campaigns SET status = 'cancelled', cancelled_at = NOW(), updated_by = :by, updated_at = NOW()
        WHERE id = :id AND status IN ('draft','scheduled') RETURNING *`,
      { replacements: { id, by: staff?.id ?? null }, type: QueryTypes.SELECT }
    );
    if (!row) throw errors.BAD_STATE({ id, status: (await this.#row(id)).status });
    return this.#view(row);
  }

  // ── Audience ──────────────────────────────────────────────────────────

  async #tree(staff) {
    const staffIds = await visibleStaffIds(this.models, staff.id, { logger: this.logger });
    return { staffIds, root: staffIds.map(Number).includes(1) };
  }

  async #assertAudienceAllowed(staff, audience) {
    if (!audience || audience.kind === 'players') return;
    if (!staff?.id) throw errors.AUDIENCE_NOT_ALLOWED({ kind: audience.kind });
    // "all" is allowed to anyone (it becomes their own tree); segment/filters need root.
    if (audience.kind === 'all') return;
    const { root } = await this.#tree(staff);
    if (!root) throw errors.AUDIENCE_NOT_ALLOWED({ kind: audience.kind });
  }

  /**
   * Who a campaign reaches.
   * @returns {{ userIds: number[], target: object, inboxable: boolean, skipped: number }}
   */
  async resolveAudience(staff, audience) {
    if (!staff?.id) throw errors.AUDIENCE_NOT_ALLOWED({ kind: audience.kind });
    const { staffIds, root } = await this.#tree(staff);
    const scope = root
      ? `(parent_staff_id IN (:staffIds) OR (parent_staff_id IS NULL AND NOT is_demo))`
      : `parent_staff_id IN (:staffIds)`;

    if (audience.kind === 'players') {
      const wanted = [...new Set(audience.userIds.map(Number))];
      const rows = await this.sql.query(`SELECT id FROM users WHERE id IN (:wanted) AND ${scope}`, {
        replacements: { wanted, staffIds },
        type: QueryTypes.SELECT,
      });
      const userIds = rows.map((r) => Number(r.id));
      if (!userIds.length) throw errors.AUDIENCE_EMPTY({ requested: wanted.length });
      return { userIds, target: { externalIds: userIds }, inboxable: true, skipped: wanted.length - userIds.length };
    }

    if (audience.kind === 'all') {
      const [{ count }] = await this.sql.query(`SELECT COUNT(*)::int AS count FROM users WHERE ${scope}`, {
        replacements: { staffIds },
        type: QueryTypes.SELECT,
      });
      if (count > MAX_CAMPAIGN_PLAYERS) throw errors.AUDIENCE_TOO_LARGE({ players: count, max: MAX_CAMPAIGN_PLAYERS });
      const rows = await this.sql.query(`SELECT id FROM users WHERE ${scope} ORDER BY id`, {
        replacements: { staffIds },
        type: QueryTypes.SELECT,
      });
      const userIds = rows.map((r) => Number(r.id));
      // A top-level operator's "all" is every subscriber of the app (one request);
      // anyone else's is their own tree, by external id.
      return { userIds, target: root ? { all: true } : { externalIds: userIds }, inboxable: true, skipped: 0 };
    }

    if (!root) throw errors.AUDIENCE_NOT_ALLOWED({ kind: audience.kind });
    if (audience.kind === 'segment') return { userIds: [], target: { segments: audience.segments }, inboxable: false, skipped: 0 };
    return { userIds: [], target: { filters: audience.filters, match: audience.match ?? 'all' }, inboxable: false, skipped: 0 };
  }

  // ── Building the message ──────────────────────────────────────────────

  async #message(c, { origin, settings, campaignId }) {
    const pick = (camel, snake) => (c[camel] !== undefined ? c[camel] : c[snake]);
    const url = absoluteUrl(pick('url', 'url'), origin);
    const buttons = (pick('buttons', 'buttons') ?? []).map((b) => ({ ...b, url: absoluteUrl(b.url, origin) || url || undefined }));
    return {
      title: c.title,
      body: c.body,
      url,
      imageUrl: pick('imageUrl', 'image_url') || null,
      iconUrl: pick('iconUrl', 'icon_url') || settings.defaultIconUrl || null,
      badgeUrl: pick('badgeUrl', 'badge_url') || null,
      buttons,
      data: { ...(c.data ?? {}), ...(campaignId ? { campaignId: String(campaignId) } : {}), kind: 'campaign' },
      priority: c.priority ?? 'normal',
      ttlSeconds: pick('ttlSeconds', 'ttl_seconds') ?? undefined,
      topic: c.topic || undefined,
      idempotencyKey: campaignId ? `push-campaign-${campaignId}` : undefined,
    };
  }

  /** What would be sent, without sending: the exact OneSignal JSON (no key), who it reaches, and every warning. */
  async preview({ staff, probe = false, ...input }) {
    const warnings = this.#checkMedia(input);
    const settings = await this.settings();
    const origin = await this.origin(settings);
    const status = await this.status();
    const resolved = await this.resolveAudience(staff, input.audience);
    const message = await this.#message(input, { origin, settings, campaignId: null });
    const target = resolved.target.all ? { segments: [settings.allSegment] } : resolved.target.externalIds
      ? { externalIds: resolved.target.externalIds.slice(0, MAX_ALIASES) }
      : resolved.target;
    const payload = buildPayload(status.appId || '<app id not set>', message, target);
    if (payload.include_aliases?.external_id?.length > 20) {
      const n = payload.include_aliases.external_id.length;
      payload.include_aliases.external_id = [...payload.include_aliases.external_id.slice(0, 20), `… ${n - 20} more`];
    }
    if (input.url && !message.url) warnings.push('The click URL is a site path but no public origin is set — it will be dropped.');
    if (!status.ready) warnings.push(status.sdkReady ? 'App API key missing — sends will write inbox rows only, nothing is pushed.' : 'OneSignal is not switched on — sends will write inbox rows only.');
    if (input.audience.kind === 'segment' || input.audience.kind === 'filters') warnings.push('Segment and tag-filter audiences are push-only: no inbox rows are written.');
    if (probe && input.imageUrl) warnings.push(...(await probeImage(input.imageUrl, this.fetchImpl)));
    return {
      payload,
      audience: {
        kind: input.audience.kind,
        players: resolved.inboxable ? resolved.userIds.length : null,
        skipped: resolved.skipped,
        inbox: resolved.inboxable && input.inbox !== false,
        oneSignalTarget: Object.keys(target)[0],
      },
      warnings,
    };
  }

  // ── Sending ───────────────────────────────────────────────────────────

  async sendCampaign({ staff, id }) {
    return this.#execute(id, { staff, from: [S.DRAFT, S.SCHEDULED, S.FAILED] });
  }

  /**
   * Send one campaign: resolve the audience (before claiming, so a refusal
   * leaves the status alone), claim it, write inbox rows (idempotent by
   * `campaign:<id>`), push, record the outcome.
   */
  async #execute(id, { staff, from }) {
    const current = await this.#row(id);
    if (!from.includes(current.status)) throw errors.BAD_STATE({ id, status: current.status });
    const actor = staff?.id ? staff : { id: current.created_by };
    const resolved = await this.resolveAudience(actor, current.audience);

    const [claimed] = await this.sql.query(
      `UPDATE push_campaigns SET status = 'sending', updated_at = NOW() WHERE id = :id AND status IN (:from) RETURNING *`,
      { replacements: { id, from }, type: QueryTypes.SELECT }
    );
    if (!claimed) throw errors.BAD_STATE({ id });

    const settings = await this.settings();
    const origin = await this.origin(settings);
    let inboxRows = 0;
    let accepted = 0;
    const onesignalIds = [];
    const failures = [];

    try {
      const message = await this.#message(claimed, { origin, settings, campaignId: claimed.id });

      if (claimed.inbox && resolved.inboxable && resolved.userIds.length) {
        inboxRows = await this.#writeInbox(resolved.userIds, claimed, message);
      }

      const provider = await this.provider();
      if (!provider) {
        failures.push('Push not configured (OneSignal off or App API key missing) — inbox only');
      } else {
        let outcome;
        if (resolved.target.all) outcome = await provider.sendToAll(message);
        else if (resolved.target.segments) outcome = await provider.sendToSegment(message, resolved.target.segments);
        else if (resolved.target.filters) outcome = await provider.sendToFilters(message, resolved.target.filters, resolved.target.match);
        else outcome = await provider.sendToUsers(resolved.target.externalIds, message);
        accepted = Number(outcome.accepted ?? 0);
        onesignalIds.push(...(outcome.notificationIds ?? []));
        failures.push(...(outcome.failures ?? []));
      }
    } catch (error) {
      failures.push(error.message);
    }

    const status = onesignalIds.length || inboxRows > 0 ? S.SENT : S.FAILED;
    const [row] = await this.sql.query(
      `UPDATE push_campaigns SET status = :status, sent_at = CASE WHEN :status = 'sent' THEN NOW() ELSE sent_at END,
          onesignal_ids = CAST(:ids AS JSONB), recipients = :recipients, accepted = :accepted, inbox_rows = :inboxRows,
          error = :error, updated_at = NOW()
        WHERE id = :id RETURNING *`,
      {
        replacements: {
          id,
          status,
          ids: JSON.stringify(onesignalIds),
          recipients: resolved.inboxable ? resolved.userIds.length : 0,
          accepted,
          inboxRows,
          error: failures.length ? failures.join('; ').slice(0, 1000) : null,
        },
        type: QueryTypes.SELECT,
      }
    );
    this.logger?.warn(
      { campaignId: Number(id), staffId: actor.id, status, recipients: resolved.userIds.length, accepted, inboxRows },
      'Push campaign sent'
    );
    return this.#view(row);
  }

  /** One bell row per player, idempotent on `campaign:<id>` so a retried send does not double them. */
  async #writeInbox(userIds, c, message) {
    const data = JSON.stringify({
      kind: 'campaign',
      campaignId: Number(c.id),
      ...(message.imageUrl ? { image: message.imageUrl } : {}),
      ...(c.url ? { link: c.url } : {}),
      ...(message.buttons?.length ? { buttons: (c.buttons ?? []).map((b) => ({ text: b.text, link: b.url ?? c.url ?? null })) } : {}),
    });
    let written = 0;
    for (let i = 0; i < userIds.length; i += 5000) {
      const chunk = userIds.slice(i, i + 5000);
      const rows = await this.sql.query(
        `INSERT INTO user_notifications (user_id, title, body, type, additional_data, is_read, delivered, dedupe_key, created_at)
         SELECT u, :title, :body, 'promotion', CAST(:data AS JSONB), FALSE, FALSE, :key, NOW()
           FROM unnest(CAST(:ids AS BIGINT[])) AS u
         ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
         RETURNING id`,
        {
          replacements: { title: String(c.title).slice(0, 200), body: c.body, data, key: `campaign:${c.id}`, ids: `{${chunk.join(',')}}` },
          type: QueryTypes.SELECT,
        }
      );
      written += rows.length;
    }
    return written;
  }

  /** A test push to one player, no inbox row, nothing recorded on a campaign. */
  async testSend({ staff, userId, ...content }) {
    const warnings = this.#checkMedia(content);
    const resolved = await this.resolveAudience(staff, { kind: 'players', userIds: [userId] }).catch((e) => {
      if (e.code === 'PUSH_AUDIENCE_EMPTY') throw errors.NOT_IN_YOUR_TREE({ userId });
      throw e;
    });
    const provider = await this.provider();
    if (!provider) throw errors.PUSH_NOT_CONFIGURED();
    const settings = await this.settings();
    const message = await this.#message(content, { origin: await this.origin(settings), settings, campaignId: null });
    message.data = { ...message.data, test: 'true' };
    const outcome = await provider.sendToUsers(resolved.userIds, message);
    this.logger?.warn({ staffId: staff?.id, userId, accepted: outcome.accepted }, 'Push test sent');
    return {
      accepted: outcome.accepted,
      notificationIds: outcome.notificationIds,
      failures: outcome.failures,
      warnings,
      hint: outcome.accepted ? null : 'OneSignal accepted nothing: that player has no subscribed browser (they must allow notifications on the site while signed in).',
    };
  }

  async testCampaign({ staff, id, userId }) {
    const c = this.#view(await this.#row(id));
    return this.testSend({ staff, userId, ...c });
  }

  /** The scheduler's tick: send every scheduled campaign that is due. */
  async runDue() {
    const due = await this.sql.query(
      `SELECT id FROM push_campaigns WHERE status = 'scheduled' AND send_at <= NOW() ORDER BY send_at LIMIT 20`,
      { type: QueryTypes.SELECT }
    );
    const out = [];
    for (const { id } of due) {
      try {
        out.push(await this.#execute(id, { staff: null, from: [S.SCHEDULED] }));
      } catch (error) {
        if (error.code === 'PUSH_BAD_STATE') continue; // another process took it
        this.logger?.error({ err: error.message, campaignId: Number(id) }, 'Scheduled push campaign failed');
        await this.sql.query(
          `UPDATE push_campaigns SET status = 'failed', error = :error, updated_at = NOW() WHERE id = :id AND status IN ('scheduled','sending')`,
          { replacements: { id, error: String(error.message).slice(0, 1000) } }
        );
      }
    }
    return out;
  }
}

module.exports = { PushService, placeholdersIn };
