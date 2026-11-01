'use strict';

const crypto = require('crypto');
const { ValidationError, imageUpload } = require('@ibitplay/common');

const { SLOTS, ASSET_FILE_RE, CONTENT_TYPES, imageProblem, cleanBranding, chatLink } = require('./branding.rules');

/** The slots the Super Admin may set (site admin → Branding). */
const SITE_SLOTS = Object.freeze(['logo', 'mark']);

/** The name and metadata fields the Super Admin may set too (site admin → Branding). */
const META_KEYS = Object.freeze(['siteName', 'title', 'titleTemplate', 'description', 'keywords', 'ogTitle', 'ogDescription', 'themeColor']);

/** The owner's metadata as one string, to tell whether the owner changed it since the Super Admin saved. */
const metaOf = (branding) => JSON.stringify(META_KEYS.map((k) => branding?.[k] ?? (k === 'keywords' ? [] : '')));

/**
 * The branding images, kept in `owner_branding_assets` (migration 142), one row per content hash.
 *
 * The owner panel uploads each image (`PUT /api/v1/admin/owner/branding/asset/<file>`,
 * `x-owner-key`); `put()` keeps it only when its bytes hash to its name and pass the image
 * checks. The signed entitlement document names each image by that hash, and only images the
 * CURRENT document names are loaded into memory (`sync`) and served publicly — so the key alone
 * can upload bytes but never put them on the site: the document's signature vouches for the hash.
 * Rows are immutable (same name = same bytes), which is what lets the gateway serve them with a
 * one-year immutable cache. Old rows are kept; they are small and a rollback needs them.
 */
const PUBLIC_PREFIX = '/api/v1/admin/branding/asset/';

const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

function createBrandingStore({ logger, models }) {
  // file → { data, contentType, version }: the images the current document names.
  const cache = new Map();
  let running = null;
  let lastKick = 0;

  const has = (name) => cache.has(name);

  // slot → the Super Admin's image (`site_branding`, migration 145).
  let overrides = new Map();
  // The Super Admin's name and metadata (`site_branding_meta`, migration 149): { meta, owner_meta } or null.
  let metaOverride = null;
  const query = (sql, replacements) =>
    models.OwnerBrandingAsset.sequelize.query(sql, { replacements, type: models.OwnerBrandingAsset.sequelize.QueryTypes.SELECT });

  async function loadOverrides() {
    try {
      const rows = await query('SELECT slot, file, content_type, byte_size, owner_file FROM site_branding');
      overrides = new Map(rows.map((r) => [r.slot, r]));
    } catch (error) {
      logger?.warn({ err: error.message }, 'site_branding not readable — the owner branding stands');
    }
    try {
      const [row] = await query('SELECT meta, owner_meta FROM site_branding_meta WHERE id = 1');
      metaOverride = row ?? null;
    } catch (error) {
      logger?.warn({ err: error.message }, 'site_branding_meta not readable — the owner metadata stands');
    }
  }

  /** Does the Super Admin's name and metadata show over this owner branding (set after the owner's)? */
  const metaBySite = (branding) => Boolean(metaOverride && metaOverride.owner_meta === metaOf(branding));

  /**
   * The branding players get: the owner's, with each Super Admin image laid over it while it is
   * the newer one — the owner's document still names the image the owner had when it was saved.
   */
  function effective(branding) {
    let out = branding;
    for (const [slot, o] of overrides) {
      if ((o.owner_file ?? null) !== (branding?.[slot]?.file ?? null)) continue;
      out = { ...(out ?? { siteName: '', keywords: [] }), [slot]: { file: o.file, type: o.content_type, bytes: o.byte_size } };
    }
    if (metaBySite(branding)) out = { ...out, ...metaOverride.meta };
    return out;
  }

  /** An upload from the owner panel. Throws a 422 for bytes that do not match the name or fail the checks. */
  async function put(file, buffer, slot) {
    if (!ASSET_FILE_RE.test(file)) throw new ValidationError('Not a branding image name');
    if (!SLOTS.includes(slot)) throw new ValidationError(`slot must be one of ${SLOTS.join(', ')}`);
    if (sha(buffer) !== file.split('.')[0]) throw new ValidationError('The bytes do not hash to the file name');
    const problem = imageProblem(buffer, file, slot);
    if (problem) throw new ValidationError(problem);
    await models.OwnerBrandingAsset.findOrCreate({
      where: { file },
      defaults: { file, content_type: CONTENT_TYPES[file.split('.')[1]], byte_size: buffer.length, bytes: buffer },
    });
    return { file, bytes: buffer.length };
  }

  /** Any stored image (the owner panel's previews), re-hashed; null when absent. */
  async function stored(name) {
    if (!ASSET_FILE_RE.test(name)) return null;
    const row = await models.OwnerBrandingAsset.findByPk(name, { raw: true });
    if (!row || sha(row.bytes) !== name.split('.')[0]) return null;
    return { data: Buffer.from(row.bytes), contentType: CONTENT_TYPES[name.split('.')[1]], version: name.split('.')[0] };
  }

  /** Load every image the branding names into memory. Never throws; one run at a time. */
  function sync(ownerBranding) {
    if (running) return running;
    running = (async () => {
      await loadOverrides();
      const branding = effective(ownerBranding);
      const result = { fetched: [], failed: [] };
      const named = new Set();
      for (const slot of SLOTS) {
        const asset = branding?.[slot];
        if (!asset) continue;
        named.add(asset.file);
        if (has(asset.file)) continue;
        try {
          const image = await stored(asset.file);
          if (!image) throw new Error('not uploaded');
          const problem = imageProblem(image.data, asset.file, slot);
          if (problem) throw new Error(problem);
          cache.set(asset.file, image);
          result.fetched.push(asset.file);
        } catch (error) {
          result.failed.push(asset.file);
          logger?.warn({ slot, file: asset.file, err: error.message }, 'Branding image not loaded — the UI keeps its own until it is');
        }
      }
      // An image the document no longer names stops being served.
      for (const name of cache.keys()) if (!named.has(name)) cache.delete(name);
      return result;
    })().finally(() => {
      running = null;
    });
    return running;
  }

  /** A read found an image missing: try again, at most every 10 s, without waiting. */
  function kick(branding) {
    if (Date.now() - lastKick < 10_000) return;
    lastKick = Date.now();
    sync(branding).catch(() => undefined);
  }

  /** The bytes of an image the current document names, or null. */
  function read(name) {
    return cache.get(name) ?? null;
  }

  /**
   * What players read. Every string already passed the rules; an image is listed only once it
   * is here (so a URL never 404s), else null and the UI keeps its own picture.
   */
  /** The site admin's chat-button settings (`siteconfig.settings`, Site config → Branding); {} when unreadable. */
  async function chatSettings() {
    try {
      const row = await models.Siteconfig?.findOne({ attributes: ['settings'], raw: true });
      return row?.settings ?? {};
    } catch (error) {
      logger?.warn({ err: error.message }, 'siteconfig not readable — no chat buttons');
      return {};
    }
  }

  function view(ownerBranding, version, settings = {}) {
    const branding = effective(ownerBranding);
    // A chat button: the owner allows it, the site admin switches it on; no valid link = shown, does nothing.
    const chat = (kind) => {
      const allowed = Boolean(branding?.[`${kind}Enabled`]);
      const enabled = allowed && settings[`${kind}_enabled`] === true;
      return { allowed, enabled, link: (enabled && chatLink(kind, settings[`${kind}_link`])) || null };
    };
    const url = (asset) => (asset && has(asset.file) ? `${PUBLIC_PREFIX}${asset.file}` : null);
    if (!branding) {
      return {
        version,
        branded: false,
        siteName: null,
        title: null,
        titleTemplate: null,
        description: null,
        keywords: [],
        ogTitle: null,
        ogDescription: null,
        themeColor: null,
        logoUrl: null,
        markUrl: null,
        ogImageUrl: null,
        whatsapp: chat('whatsapp'),
        telegram: chat('telegram'),
      };
    }
    if (SLOTS.some((s) => branding[s] && !has(branding[s].file))) kick(ownerBranding);
    const orNull = (v) => v || null;
    return {
      version,
      branded: Boolean(branding.siteName),
      siteName: orNull(branding.siteName),
      title: orNull(branding.title),
      titleTemplate: orNull(branding.titleTemplate),
      description: orNull(branding.description),
      keywords: [...branding.keywords],
      ogTitle: orNull(branding.ogTitle),
      ogDescription: orNull(branding.ogDescription),
      themeColor: orNull(branding.themeColor),
      logoUrl: url(branding.logo),
      markUrl: url(branding.mark),
      ogImageUrl: url(branding.ogImage),
      whatsapp: chat('whatsapp'),
      telegram: chat('telegram'),
    };
  }

  /** The Super Admin sets a logo / icon: stored by hash like the owner's, then shown (it is the newest). */
  async function setSite(slot, buffer, { staff, ownerBranding }) {
    if (!SITE_SLOTS.includes(slot)) throw new ValidationError(`slot must be one of ${SITE_SLOTS.join(', ')}`);
    const ext = imageUpload.sniff(buffer)?.extension?.replace('.', '') ?? 'svg';
    if (!CONTENT_TYPES[ext]) throw new ValidationError('Upload a PNG, WebP or SVG image');
    const file = `${sha(buffer)}.${ext}`;
    await put(file, buffer, slot);
    await query(
      `INSERT INTO site_branding (slot, file, content_type, byte_size, owner_file, updated_by, updated_at)
       VALUES (:slot, :file, :type, :bytes, :ownerFile, :staffId, CURRENT_TIMESTAMP)
       ON CONFLICT (slot) DO UPDATE SET file = EXCLUDED.file, content_type = EXCLUDED.content_type, byte_size = EXCLUDED.byte_size,
         owner_file = EXCLUDED.owner_file, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
      { slot, file, type: CONTENT_TYPES[ext], bytes: buffer.length, ownerFile: ownerBranding?.[slot]?.file ?? null, staffId: staff?.id ?? null }
    );
    overrides.set(slot, { slot, file, content_type: CONTENT_TYPES[ext], byte_size: buffer.length, owner_file: ownerBranding?.[slot]?.file ?? null });
    await sync(ownerBranding);
    return { slot, file };
  }

  /** Back to the owner's image (or the UI's own) for that slot. */
  async function clearSite(slot, { ownerBranding }) {
    if (!SITE_SLOTS.includes(slot)) throw new ValidationError(`slot must be one of ${SITE_SLOTS.join(', ')}`);
    await query('DELETE FROM site_branding WHERE slot = :slot', { slot });
    overrides.delete(slot);
    await sync(ownerBranding);
    return { slot };
  }

  /** The Super Admin sets the name and metadata: shown until the owner changes theirs. */
  async function setMeta(input, { staff, ownerBranding }) {
    const clean = cleanBranding(input);
    const meta = Object.fromEntries(META_KEYS.map((k) => [k, clean[k]]));
    const ownerMeta = metaOf(ownerBranding);
    await query(
      `INSERT INTO site_branding_meta (id, meta, owner_meta, updated_by, updated_at)
       VALUES (1, CAST(:meta AS jsonb), :ownerMeta, :staffId, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE SET meta = EXCLUDED.meta, owner_meta = EXCLUDED.owner_meta, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
      { meta: JSON.stringify(meta), ownerMeta, staffId: staff?.id ?? null }
    );
    metaOverride = { meta, owner_meta: ownerMeta };
    return meta;
  }

  /** Back to the owner's name and metadata (or the site's own). */
  async function clearMeta() {
    await query('DELETE FROM site_branding_meta WHERE id = 1');
    metaOverride = null;
  }

  return { sync, read, view, chatSettings, put, stored, setSite, clearSite, setMeta, clearMeta, metaBySite };
}

let shared = null;

/** The process's one store (routes and the entitlements store's onChange share it). */
function brandingStore({ logger, models }) {
  if (!shared) shared = createBrandingStore({ logger, models });
  return shared;
}

module.exports = { createBrandingStore, brandingStore, PUBLIC_PREFIX, SITE_SLOTS, META_KEYS, metaOf };
