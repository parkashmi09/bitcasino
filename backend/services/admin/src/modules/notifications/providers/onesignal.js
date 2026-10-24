'use strict';

/**
 * OneSignal web push.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * HOW THIS DIFFERS FROM THE FIREBASE PATH
 *
 * Firebase is addressed by DEVICE TOKEN, so this platform stores a token per
 * device (`user_fcm_tokens`) and sends to the list. OneSignal keeps the
 * device list itself. The browser SDK calls `OneSignal.login(<player id>)`,
 * which ties that browser's subscription to the player as an `external_id`,
 * and a send names the player, not the device. So there is no token table to
 * keep in step, and a player with three browsers gets all three.
 *
 * The consequence for this service: a send cannot know how many devices it
 * reached. OneSignal answers with a notification id when it ACCEPTS the send
 * and delivers asynchronously. `accepted` is reported, not `delivered`.
 *
 * ── THE TWO KEYS ────────────────────────────────────────────────────────
 *
 * `appId` is public — the web SDK needs it in the page. `apiKey` is the REST
 * key and can push to every subscriber of the app, so it lives sealed in
 * `site_features.secrets` and is opened only here, in memory, per send.
 *
 * New "App API keys" start `os_v2_` and authenticate as `Key <key>`; the
 * older REST API keys authenticate as `Basic <key>`. Both are accepted.
 * ═════════════════════════════════════════════════════════════════════════
 */

const ENDPOINT = 'https://api.onesignal.com/notifications?c=push';
const API_ORIGIN = 'https://api.onesignal.com';
/** OneSignal's ceiling on `include_aliases.external_id` per request. */
const MAX_ALIASES = 2000;
const DEFAULT_SEGMENT = 'Subscribed Users';
/** OneSignal's "everyone subscribed" segment on apps created since 2024; older apps call it "Subscribed Users". */
const ALL_SEGMENT = 'Total Subscriptions';
/** Web buttons: Chrome shows at most two. */
const MAX_BUTTONS = 2;
/** Tag relations OneSignal's `filters` accept. */
const TAG_RELATIONS = Object.freeze(['=', '!=', '>', '<', 'exists', 'not_exists', 'time_elapsed_gt', 'time_elapsed_lt']);
const PRIORITY = Object.freeze({ normal: 5, high: 10 });

class OneSignalError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'OneSignalError';
    this.status = status;
    this.body = body;
  }
}

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

/**
 * Who a send goes to — OneSignal's three targeting modes.
 *
 *   { externalIds: [..] }                       players by platform id (include_aliases)
 *   { segments: ['Total Subscriptions'], excludedSegments?: [..] }
 *   { filters: [{ tag, relation, value }], match: 'all'|'any' }
 */
function targetFields(target) {
  if (!target) throw new OneSignalError('A send needs a target');
  if (Array.isArray(target.externalIds)) {
    const ids = [...new Set(target.externalIds.map(String))].filter(Boolean);
    if (!ids.length) throw new OneSignalError('No players to send to');
    if (ids.length > MAX_ALIASES) throw new OneSignalError(`At most ${MAX_ALIASES} players per request`);
    return { include_aliases: { external_id: ids } };
  }
  if (Array.isArray(target.segments)) {
    const segments = target.segments.map((s) => String(s).trim()).filter(Boolean);
    if (!segments.length) throw new OneSignalError('No segment named');
    const excluded = (target.excludedSegments ?? []).map((s) => String(s).trim()).filter(Boolean);
    return { included_segments: segments, ...(excluded.length ? { excluded_segments: excluded } : {}) };
  }
  if (Array.isArray(target.filters)) {
    if (!target.filters.length) throw new OneSignalError('No filter given');
    const out = [];
    target.filters.forEach((f, i) => {
      if (!TAG_RELATIONS.includes(f.relation)) throw new OneSignalError(`Unknown tag relation "${f.relation}"`);
      if (i > 0 && target.match === 'any') out.push({ operator: 'OR' });
      const needsValue = !['exists', 'not_exists'].includes(f.relation);
      out.push({ field: 'tag', key: String(f.tag), relation: f.relation, ...(needsValue ? { value: String(f.value ?? '') } : {}) });
    });
    return { filters: out };
  }
  throw new OneSignalError('Unknown target');
}

/**
 * The notification body OneSignal is sent — pure, so it is tested without a
 * network and shown verbatim by the admin "preview".
 *
 * message: { title, body, url, imageUrl, iconUrl, badgeUrl, buttons:[{id,text,url,icon}],
 *            data, type, priority:'normal'|'high', ttlSeconds, sendAfter, topic, idempotencyKey }
 */
function buildPayload(appId, message, target) {
  const title = String(message.title ?? '').trim();
  // `contents` is required and must not be empty; a title-only notification
  // repeats the title rather than being refused.
  const body = String(message.body ?? '').trim() || title;
  const data = isObject(message.data) ? { ...message.data } : {};
  if (message.type) data.type = message.type;

  const payload = {
    app_id: appId,
    target_channel: 'push',
    headings: { en: title },
    contents: { en: body },
  };
  if (Object.keys(data).length) payload.data = data;
  if (message.url) payload.url = message.url;

  // Big picture. Chrome (desktop + Android) reads chrome_web_image; the
  // native fields ride along so a future app build shows the same image.
  if (message.imageUrl) {
    payload.chrome_web_image = message.imageUrl;
    payload.big_picture = message.imageUrl;
    payload.ios_attachments = { image: message.imageUrl };
  }
  if (message.iconUrl) {
    payload.chrome_web_icon = message.iconUrl;
    payload.firefox_icon = message.iconUrl;
  }
  if (message.badgeUrl) payload.chrome_web_badge = message.badgeUrl;

  const buttons = Array.isArray(message.buttons) ? message.buttons.slice(0, MAX_BUTTONS) : [];
  if (buttons.length) {
    payload.web_buttons = buttons.map((b, i) => ({
      id: String(b.id || `btn${i + 1}`),
      text: String(b.text),
      // A web button without a URL does nothing on click; fall back to the notification's.
      ...(b.url || message.url ? { url: b.url || message.url } : {}),
      ...(b.icon ? { icon: b.icon } : {}),
    }));
  }

  if (message.priority && PRIORITY[message.priority]) payload.priority = PRIORITY[message.priority];
  if (Number.isInteger(message.ttlSeconds) && message.ttlSeconds >= 0) payload.ttl = message.ttlSeconds;
  if (message.sendAfter) payload.send_after = new Date(message.sendAfter).toISOString();
  if (message.topic) {
    // Same topic = the newer push replaces the older one on the device.
    payload.web_push_topic = String(message.topic);
    payload.collapse_id = String(message.topic).slice(0, 64);
  }
  if (message.idempotencyKey) payload.idempotency_key = message.idempotencyKey;

  return { ...payload, ...targetFields(target) };
}

class OneSignalProvider {
  constructor({ appId, apiKey, segment, allSegment, logger, fetchImpl = globalThis.fetch, timeoutMs = 10_000, endpoint = ENDPOINT }) {
    if (!appId) throw new OneSignalError('OneSignal appId is missing');
    if (!apiKey) throw new OneSignalError('OneSignal apiKey is missing');
    this.appId = appId;
    this.apiKey = apiKey;
    this.segment = segment || DEFAULT_SEGMENT;
    this.allSegment = allSegment || ALL_SEGMENT;
    this.logger = logger;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.endpoint = endpoint;
  }

  get name() {
    return 'onesignal';
  }

  #authorization() {
    return String(this.apiKey).startsWith('os_v2_') ? `Key ${this.apiKey}` : `Basic ${this.apiKey}`;
  }

  /** The exact JSON a send would POST (no key in it). */
  payload(message, target) {
    return buildPayload(this.appId, message, target);
  }

  async #request(url, method, body) {
    const res = await this.fetch(url, {
      method,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: this.#authorization(),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!res.ok) {
      const reason = Array.isArray(json?.errors) ? json.errors.join('; ') : text.slice(0, 200) || res.statusText;
      throw new OneSignalError(`OneSignal refused the request (${res.status}): ${reason}`, { status: res.status, body: json });
    }
    return json;
  }

  async #post(body) {
    const json = await this.#request(this.endpoint, 'POST', body);
    // 200 with an empty id is OneSignal's "nobody to send to", e.g. no
    // subscribed browser for any of the named players. Not an error.
    const errors = Array.isArray(json?.errors) ? json.errors : json?.errors ? [json.errors] : [];
    return { id: json?.id || null, errors, recipients: Number.isFinite(json?.recipients) ? json.recipients : null };
  }

  /**
   * Push to named players. `externalIds` are platform user ids, which is what
   * the front ends pass to `OneSignal.login`. Batched by 2000.
   *
   * `accepted` counts players in batches OneSignal ACCEPTED (returned an id);
   * delivery happens later and is not observable here.
   */
  async sendToUsers(externalIds, message) {
    const ids = [...new Set(externalIds.map(String))].filter(Boolean);
    let accepted = 0;
    const failures = [];
    const notificationIds = [];

    for (let i = 0; i < ids.length; i += MAX_ALIASES) {
      const batch = ids.slice(i, i + MAX_ALIASES);
      try {
        const idem = message.idempotencyKey ? batchKey(message.idempotencyKey, i / MAX_ALIASES) : undefined;
        const result = await this.#post(buildPayload(this.appId, { ...message, idempotencyKey: idem }, { externalIds: batch }));
        if (result.id) {
          accepted += batch.length;
          notificationIds.push(result.id);
        }
        if (result.errors.length) failures.push(...result.errors.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))));
      } catch (error) {
        this.logger?.error({ err: error.message, batch: batch.length }, 'OneSignal batch failed');
        failures.push(error.message);
      }
    }

    return { accepted, delivered: accepted, failures, notificationIds, provider: this.name };
  }

  /** Push to OneSignal segment(s). `accepted` is 1 notification, or OneSignal's recipient count when it reports one. */
  async sendToSegment(message, segment = this.segment) {
    const segments = Array.isArray(segment) ? segment : [segment];
    const result = await this.#post(buildPayload(this.appId, message, { segments }));
    return {
      accepted: result.id ? (result.recipients ?? 1) : 0,
      failures: result.errors.map(String),
      notificationIds: result.id ? [result.id] : [],
      provider: this.name,
    };
  }

  /** Everyone subscribed to the app. */
  async sendToAll(message) {
    return this.sendToSegment(message, this.allSegment);
  }

  /** Push to subscribers whose tags match. */
  async sendToFilters(message, filters, match = 'all') {
    const result = await this.#post(buildPayload(this.appId, message, { filters, match }));
    return {
      accepted: result.id ? (result.recipients ?? 1) : 0,
      failures: result.errors.map(String),
      notificationIds: result.id ? [result.id] : [],
      provider: this.name,
    };
  }

  /** Cancel a notification OneSignal is still holding (a `send_after` one). */
  async cancel(notificationId) {
    const url = `${API_ORIGIN}/notifications/${encodeURIComponent(notificationId)}?app_id=${encodeURIComponent(this.appId)}`;
    const json = await this.#request(url, 'DELETE');
    return { cancelled: json?.success !== false };
  }
}

/** A deterministic UUID-shaped key per batch, so a retried send is de-duplicated by OneSignal. */
function batchKey(key, index) {
  const hex = require('crypto').createHash('sha256').update(`${key}:${index}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

module.exports = {
  OneSignalProvider,
  OneSignalError,
  buildPayload,
  targetFields,
  batchKey,
  MAX_ALIASES,
  MAX_BUTTONS,
  TAG_RELATIONS,
  DEFAULT_SEGMENT,
  ALL_SEGMENT,
  ENDPOINT,
};
