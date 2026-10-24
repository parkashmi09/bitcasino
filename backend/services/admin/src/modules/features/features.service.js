'use strict';

const { featureCatalogue, entitlements, featureOptions, regionPolicy, withdrawalCap, withdrawalDailyLimit } = require('@ibitplay/common');
const { createSecretBox } = require('@ibitplay/auth');

const errors = require('./features.errors');
const ownerErrors = require('./owner.errors');
const { SiteConfigService } = require('../site-config/siteConfig.service');
const { OneSignalProvider } = require('../notifications/providers/onesignal');

const { FEATURES, TEMPLATES, featureByKey, variantOf, defaultVariantOf, isPolicy, resolveVariantKey, resolveTemplateKey } = featureCatalogue;

/** The row that remembers which template the site was last set from. */
const TEMPLATE_ROW = '_template';

/** `updated_by` on a row the owner's template wrote. */
const OWNER_WRITER = 'owner';

/**
 * Template applications run one at a time per process: the first poll's
 * owner template and the boot-time SITE_TEMPLATE must not interleave their
 * row-by-row upserts on a fresh database.
 */
let templateQueue = Promise.resolve();
function serialiseTemplate(work) {
  const run = templateQueue.then(work, work);
  templateQueue = run.catch(() => {});
  return run;
}

/** A document from an owner panel that sets each feature's variant and on/off. */
function hasVariants(doc) {
  return Boolean(doc?.variants) && typeof doc.variants === 'object' && !Array.isArray(doc.variants);
}

/** `{ key, label, setBy }` for a stored template name (old names resolved), or null. */
function describeTemplate(stored) {
  if (!stored) return null;
  const key = resolveTemplateKey(stored);
  // The template is the owner's to set; the site admin only reads it.
  return { key, label: TEMPLATES[key]?.label ?? key, setBy: 'owner' };
}

/**
 * Which variant of each feature this site offers — and the sealed keys an
 * integration needs.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * READS ARE ALWAYS AGAINST THE DATABASE
 *
 * No cache. The point of the owner panel is that an operator enters a key and
 * the next notification uses it, on every site, without a restart. A cache
 * would make "I just turned it on" false for however long it lives, and sends
 * are rare enough that one primary-key read each is nothing.
 * ═════════════════════════════════════════════════════════════════════════
 */
class FeaturesService {
  constructor({ models, logger, config, fetchImpl, clients = null }) {
    this.models = models;
    this.logger = logger;
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.siteConfig = new SiteConfigService({ models, logger, config, clients });
    this.box = null;
  }

  /**
   * Whether this site's features are set in the owner panel. With no
   * OWNER_SHARED_SECRET no owner panel can write here: the site is not
   * managed, and staff keep every switch (the hub's "inert" behaviour).
   */
  ownerManaged() {
    return Boolean(this.config?.OWNER_SHARED_SECRET);
  }

  #secretBox() {
    if (!this.box) this.box = createSecretBox({ config: this.config, logger: this.logger });
    return this.box;
  }

  catalogue() {
    return {
      features: FEATURES.map((f) => ({
        key: f.key,
        label: f.label,
        category: f.category,
        kind: f.kind ?? 'feature',
        defaultVariant: defaultVariantOf(f.key),
        flag: f.flag,
        variants: f.variants.map((v) => ({
          key: v.key,
          label: v.label,
          description: v.description,
          configFields: v.configFields ?? [],
          // Labels only — which secrets a variant needs, never their values.
          secretFields: (v.secretFields ?? []).map(({ key, label, required }) => ({ key, label, required })),
        })),
      })),
      // Generic names only — no `builtFor`, no site a bundle was ported from.
      templates: Object.entries(TEMPLATES).map(([key, t]) => ({ key, label: t.label, description: t.description, variants: { ...t.variants } })),
    };
  }

  async #rows() {
    const rows = await this.models.SiteFeature.findAll({ raw: true });
    return new Map(rows.map((r) => [r.feature, r]));
  }

  /** What an operator sees: every catalogue feature, stored or not, with which secrets are SET. */
  async list() {
    const rows = await this.#rows();
    const plan = await entitlements.getEntitlements();
    // A row written before migration 059 still holds the old name.
    const template = describeTemplate(rows.get(TEMPLATE_ROW)?.variant);
    // On/off and variant come from the owner panel; staff only see them.
    const managedBy = this.ownerManaged() ? OWNER_WRITER : null;
    return {
      template,
      managedBy,
      features: FEATURES.map((f) => {
        const row = rows.get(f.key);
        const policy = isPolicy(f.key);
        // A row written before migration 048 still holds the old name.
        const variant = resolveVariantKey(f.key, row?.variant ?? defaultVariantOf(f.key));
        const spec = variantOf(f.key, variant);
        // A policy is always in force; its "off" is the `none` variant.
        const enabled = policy ? variant !== 'none' : Boolean(row?.enabled);
        // The owner's plan — the feature and its linked flag.
        const entitled = entitlements.isFeatureEntitledIn(plan, f.key);
        return {
          feature: f.key,
          label: f.label,
          category: f.category,
          kind: policy ? 'policy' : 'feature',
          enabled,
          // What players get: the row as the owner's document applied it, within the plan.
          on: enabled && entitled,
          isDefault: !row,
          flag: f.flag,
          entitled,
          managedBy,
          variant,
          variantLabel: spec?.label ?? variant,
          config: row?.config ?? {},
          secretsSet: Object.fromEntries((spec?.secretFields ?? []).map((s) => [s.key, Boolean(row?.secrets?.[s.key])])),
          updatedBy: row?.updated_by ?? null,
          updatedAt: row?.updated_at ?? null,
          // Region restriction: the owner's list type and countries, shown read-only beside the mode.
          ...(f.key === regionPolicy.FEATURE_KEY ? { region: regionPolicy.cleanRegion(plan.region) } : {}),
          // Withdrawal requirements: the owner's deposit cap, shown read-only beside KYC / wagering.
          ...(f.key === 'withdrawal_requirements'
            ? {
                withdrawalCap: withdrawalCap.cleanWithdrawalCap(plan.withdrawalCap),
                withdrawalDailyLimit: withdrawalDailyLimit.cleanWithdrawalDailyLimit(plan.withdrawalDailyLimit),
              }
            : {}),
        };
      }),
    };
  }

  /**
   * What a browser may read. Only switched-on features, and of their config
   * only what the variant marks public — for push that is the App ID and
   * nothing else. `secrets` never leaves this class except opened in memory.
   */
  async publicList() {
    const rows = await this.#rows();
    const plan = await entitlements.getEntitlements();
    // The owner's template also names the site's colour theme (Carbon Gold,
    // Violet Night…); front ends switch their palette from this row.
    const template = describeTemplate(rows.get(TEMPLATE_ROW)?.variant);
    const theme = template ? [{ feature: 'theme', kind: 'theme', variant: template.key }] : [];
    return [...theme, ...FEATURES.flatMap((f) => {
      const row = rows.get(f.key);
      // Not in the owner's plan reads as switched off — a closed policy is `none`.
      if (!entitlements.isFeatureEntitledIn(plan, f.key)) return isPolicy(f.key) ? [{ feature: f.key, kind: 'policy', variant: 'none' }] : [];
      // A policy is always published — a front end needs to know a cashier is
      // CLOSED as much as which kind it is, so `none` is listed too.
      if (isPolicy(f.key)) return [{ feature: f.key, kind: 'policy', variant: resolveVariantKey(f.key, row?.variant ?? defaultVariantOf(f.key)) }];
      if (!row?.enabled || row.variant === 'none') return [];
      const variant = resolveVariantKey(f.key, row.variant);
      const spec = variantOf(f.key, variant);
      const publicFields = spec?.publicFields ?? [];
      const config = Object.fromEntries(publicFields.filter((k) => row.config?.[k]).map((k) => [k, row.config[k]]));
      // The owner's options for this feature (e.g. when the spin wheel grants a spin), defaults filled in.
      const options = featureOptions.FEATURE_OPTIONS[f.key] ? featureOptions.resolveOptions(plan, f.key) : null;
      return [{ feature: f.key, variant, ...(publicFields.length ? { config } : {}), ...(options ? { options } : {}) }];
    })];
  }

  #validateFields(feature, variant, { config, secrets }, existing) {
    const spec = variantOf(feature, variant);
    const allowedConfig = new Map((spec.configFields ?? []).map((f) => [f.key, f]));
    const allowedSecrets = new Map((spec.secretFields ?? []).map((f) => [f.key, f]));

    // An empty string is a request to CLEAR. The field being absent is already
    // true of a variant that does not declare it, so that is a no-op, not an
    // error — otherwise "switch to Off and wipe the key" could not be one call,
    // and a failed wipe leaves a sealed key behind.
    for (const key of Object.keys(config ?? {})) {
      if (config[key] === '' && !allowedConfig.has(key)) continue;
      if (!allowedConfig.has(key)) throw errors.UNEXPECTED_FIELD({ feature, variant, field: key });
      const rule = allowedConfig.get(key);
      if (config[key] && rule.pattern && !new RegExp(rule.pattern).test(config[key])) {
        throw errors.INVALID_FIELD({ feature, field: key, expected: rule.pattern });
      }
    }
    for (const key of Object.keys(secrets ?? {})) {
      if (secrets[key] === '' && !allowedSecrets.has(key)) continue;
      if (!allowedSecrets.has(key)) throw errors.UNEXPECTED_FIELD({ feature, variant, field: key });
    }

    return { allowedConfig, allowedSecrets };
  }

  async update({ feature, patch, staff }) {
    const f = featureByKey(feature);
    if (!f) throw errors.UNKNOWN_FEATURE({ feature });

    const current = await this.models.SiteFeature.findByPk(feature, { raw: true });
    const policy = isPolicy(feature);
    const managed = this.ownerManaged();

    // The variant is the owner's (docs/OWNER-PANEL.md §4). The on/off switch the
    // Super Admin may flip too, inside the owner's plan: the latest change, either
    // side, stands (applyOwnerDocument keeps it until the owner changes that feature).
    let enabledChange = false;
    if (managed) {
      const currentVariant = resolveVariantKey(feature, current?.variant ?? defaultVariantOf(feature));
      const currentEnabled = policy ? currentVariant !== 'none' : Boolean(current?.enabled);
      const variantChange = patch.variant !== undefined && resolveVariantKey(feature, patch.variant) !== currentVariant;
      // A policy has no switch of its own (its `enabled` follows the variant).
      enabledChange = !policy && patch.enabled !== undefined && Boolean(patch.enabled) !== currentEnabled;
      if (variantChange) throw ownerErrors.MANAGED({ feature });
    }
    // An old name from a client that has not been redeployed is accepted and
    // stored under the current one — see LEGACY_VARIANTS.
    const variant = resolveVariantKey(feature, patch.variant ?? current?.variant ?? defaultVariantOf(feature));
    if (!variantOf(feature, variant)) {
      throw errors.UNKNOWN_VARIANT({ feature, variant, allowed: f.variants.map((v) => v.key) });
    }

    const { allowedConfig, allowedSecrets } = this.#validateFields(feature, variant, patch, current);

    // Switching variant drops fields the new one does not declare.
    const keptConfig = Object.fromEntries(Object.entries(current?.config ?? {}).filter(([k]) => allowedConfig.has(k)));
    const config = { ...keptConfig };
    for (const [k, v] of Object.entries(patch.config ?? {})) {
      if (!allowedConfig.has(k)) continue;
      if (v === '') delete config[k];
      else config[k] = v;
    }

    const keptSecrets = Object.fromEntries(Object.entries(current?.secrets ?? {}).filter(([k]) => allowedSecrets.has(k)));
    const secrets = { ...keptSecrets };
    for (const [k, v] of Object.entries(patch.secrets ?? {})) {
      if (!allowedSecrets.has(k)) continue;
      if (v === '') delete secrets[k];
      else secrets[k] = this.#secretBox().seal(v);
    }

    let enabled = patch.enabled ?? current?.enabled ?? false;
    if (variant === 'none') enabled = false;
    // A policy has no switch: it is in force at whatever variant it holds.
    if (policy) enabled = variant !== 'none';

    // The owner's plan comes first: nothing outside it can be left switched on.
    // Owner-managed, staff cannot switch anything on; the owner's own choice stands.
    if (enabled && (!managed || enabledChange)) await entitlements.assertFeatureEntitled(feature);

    // Refuse to switch an integration on without what it needs to run.
    if (enabled) {
      const spec = variantOf(feature, variant);
      const missing = [
        ...(spec.configFields ?? []).filter((r) => r.required && !config[r.key]).map((r) => r.key),
        ...(spec.secretFields ?? []).filter((r) => r.required && !secrets[r.key]).map((r) => r.key),
      ];
      if (missing.length) throw errors.MISSING_FIELD({ feature, variant, missing });
    }

    await this.models.SiteFeature.upsert({
      feature,
      enabled,
      variant,
      config,
      secrets,
      updated_by: staff ? `staff:${staff.id}` : null,
    });

    await this.#syncFlag(f, enabled && variant !== 'none', staff);

    this.logger?.warn(
      {
        staffId: staff?.id,
        feature,
        policy,
        from: current?.variant ?? defaultVariantOf(feature),
        variant,
        enabled,
        configKeys: Object.keys(config),
        // Names only. The values are sealed and never logged.
        secretsChanged: Object.keys(patch.secrets ?? {}),
      },
      'Site feature changed'
    );

    // The flag mirror already pushed the flags; now the variants themselves.
    await this.siteConfig.pushPublic({ features: await this.publicList() });

    return (await this.list()).features.find((x) => x.feature === feature);
  }

  /** Keep the legacy siteconfig column in step, so older readers agree. */
  async #syncFlag(feature, on, staff) {
    if (!feature.flag) return;
    try {
      await this.siteConfig.updateGlobalSettings({ staffId: staff?.id ?? null, [feature.flag]: on });
    } catch (error) {
      // A site with no siteconfig row still gets its feature row; the flag is
      // a mirror, not the source.
      this.logger?.warn({ err: error.message, flag: feature.flag }, 'Could not mirror a feature onto its siteconfig flag');
    }
  }

  /**
   * Set every feature of a template. Not reachable by staff (the route answers
   * TEMPLATE_OWNER_ONLY): the owner's document drives it through
   * applyOwnerTemplate(), and a fresh database through SITE_TEMPLATE.
   */
  async applyTemplate({ template: requested, enable, staff, setBy = null }) {
    // An old (clone) name from SITE_TEMPLATE or sites.json — see LEGACY_TEMPLATES.
    const template = resolveTemplateKey(requested);
    const t = TEMPLATES[template];
    if (!t) throw errors.UNKNOWN_TEMPLATE({ template });
    const writer = setBy === OWNER_WRITER ? OWNER_WRITER : staff ? `staff:${staff.id}` : null;

    const applied = [];
    const plan = await entitlements.getEntitlements();
    for (const [feature, variant] of Object.entries(t.variants)) {
      // Only what the owner's plan includes; the rest is left exactly as it is.
      if (!entitlements.isFeatureEntitledIn(plan, feature)) continue;
      // Business policies are set on purpose, one at a time. A template that
      // reopened a cashier someone had closed would fail in the worst direction.
      if (isPolicy(feature)) continue;
      const current = await this.models.SiteFeature.findByPk(feature, { raw: true });
      // Never let a template silently change an integration someone keyed in.
      if (featureByKey(feature)?.category === 'integration' && current && current.variant !== 'none') continue;

      const spec = variantOf(feature, variant);
      const needsKeys = [...(spec.configFields ?? []), ...(spec.secretFields ?? [])].some((r) => r.required);
      const on = enable && variant !== 'none' && !needsKeys;
      const keepSameVariant = current?.variant === variant;

      await this.models.SiteFeature.upsert({
        feature,
        variant,
        enabled: on,
        config: keepSameVariant ? current.config : {},
        secrets: keepSameVariant ? current.secrets : {},
        updated_by: writer,
      });
      await this.#syncFlag(featureByKey(feature), on, staff);
      applied.push({ feature, variant, enabled: on });
    }

    await this.models.SiteFeature.upsert({
      feature: TEMPLATE_ROW,
      variant: template,
      enabled: true,
      config: {},
      secrets: {},
      updated_by: writer,
    });

    await this.siteConfig.pushPublic({ features: await this.publicList() });

    this.logger?.warn({ staffId: staff?.id, setBy: writer, template, features: applied.length }, 'Site template applied');
    return { template, applied };
  }

  /**
   * The owner's document names a template (docs/OWNER-PANEL.md §2). Applied
   * when it differs from the `_template` row — compared with the row, not the
   * previous document, so a failed apply is retried on the next change and a
   * restart does not re-apply over the site admin's per-feature choices.
   * Returns the application, or null when there was nothing to do.
   */
  async applyOwnerTemplate(requested) {
    if (!requested) return null;
    const template = resolveTemplateKey(requested);
    if (!TEMPLATES[template]) {
      this.logger?.warn({ template }, 'The owner document names a template the catalogue does not have — ignoring it');
      return null;
    }
    return serialiseTemplate(async () => {
      const row = await this.models.SiteFeature.findByPk(TEMPLATE_ROW, { raw: true, attributes: ['variant'] });
      if (row && resolveTemplateKey(row.variant) === template) return null;
      return this.applyTemplate({ template, enable: true, staff: null, setBy: OWNER_WRITER });
    });
  }

  /**
   * The owner's document sets every feature (docs/OWNER-PANEL.md §2, §3):
   * `features[key] !== false` is ON (a policy is always in force; its variant
   * is the policy) and `variants[key]` is the variant when it is one the
   * feature has — a missing or unknown one keeps the site's current variant.
   * Only rows that differ are written (`updated_by: 'owner'`); config and
   * sealed keys are never touched. `template` only records the theme here.
   *
   * A document without `variants` (an older owner panel) is not applied this
   * way — see onEntitlementsChange(). Returns `{ applied, ignored, template }`
   * or null when there was no such document. Pushes `featuresUpdated` when
   * something changed.
   */
  async applyOwnerDocument(doc) {
    if (!hasVariants(doc)) return null;
    return serialiseTemplate(async () => {
      const rows = await this.#rows();
      const applied = [];
      const ignored = [];
      for (const f of FEATURES) {
        const row = rows.get(f.key);
        const policy = isPolicy(f.key);
        const currentVariant = resolveVariantKey(f.key, row?.variant ?? defaultVariantOf(f.key));
        const currentEnabled = policy ? currentVariant !== 'none' : Boolean(row?.enabled);

        let variant = currentVariant;
        const asked = doc.variants[f.key];
        if (typeof asked === 'string' && asked) {
          const resolved = resolveVariantKey(f.key, asked);
          if (variantOf(f.key, resolved)) variant = resolved;
          else ignored.push({ feature: f.key, variant: asked });
        }
        // `none` is off whatever the switch says, as in update().
        const ownerOn = policy ? variant !== 'none' : doc.features?.[f.key] !== false && variant !== 'none';
        // A Super Admin's switch stands while the owner has not changed this feature since.
        const staffKept =
          !policy && variant === currentVariant && String(row?.updated_by ?? '').startsWith('staff:') && row?.owner_enabled === ownerOn;
        const enabled = staffKept ? Boolean(row.enabled) : ownerOn;
        if (row && row.variant === variant && Boolean(row.enabled) === enabled && row.owner_enabled === ownerOn) continue;
        if (!row && variant === currentVariant && enabled === currentEnabled) continue;

        await this.models.SiteFeature.upsert({
          feature: f.key,
          variant,
          enabled,
          owner_enabled: ownerOn,
          config: row?.config ?? {},
          secrets: row?.secrets ?? {},
          updated_by: staffKept ? row.updated_by : OWNER_WRITER,
        });
        if (!policy && enabled !== currentEnabled) await this.#syncFlag(f, enabled, null);
        applied.push({ feature: f.key, variant, enabled });
      }

      // The template still names the theme (and the preset the owner panel started from).
      let template = null;
      if (doc.template) {
        const key = resolveTemplateKey(doc.template);
        const stored = rows.get(TEMPLATE_ROW)?.variant;
        if (TEMPLATES[key] && (!stored || resolveTemplateKey(stored) !== key)) {
          await this.models.SiteFeature.upsert({ feature: TEMPLATE_ROW, variant: key, enabled: true, config: {}, secrets: {}, updated_by: OWNER_WRITER });
          template = key;
        }
      }

      if (ignored.length) this.logger?.warn({ ignored }, 'The owner document names variants the catalogue does not have — those features keep their variant');
      if (applied.length || template) {
        await this.siteConfig.pushPublic({ features: await this.publicList() });
        this.logger?.warn({ version: doc.version, applied: applied.length, template }, 'Owner document applied to site features');
      }
      return { applied, ignored, template };
    });
  }

  /**
   * The owner's document at boot or on a new version: its variants and
   * on/off when it carries `variants`, else (an older document) its template
   * when that changed. A failure is logged, never thrown.
   */
  async applyOwner(current) {
    await this.#applyOwnerCoins(current);
    try {
      return hasVariants(current) ? await this.applyOwnerDocument(current) : await this.applyOwnerTemplate(current?.template);
    } catch (error) {
      this.logger?.error({ err: error.message, version: current?.version }, 'Could not apply the owner document');
      return null;
    }
  }

  /**
   * The document's per-coin flags → `currencies.owner_enabled` (migration
   * 061), with or without `variants`. Logged, never thrown.
   */
  async #applyOwnerCoins(current) {
    try {
      // Required here: the currencies service requires the site-config service, as this one does.
      // eslint-disable-next-line global-require
      const { CurrenciesService } = require('../currencies/currencies.service');
      await new CurrenciesService({ models: this.models, logger: this.logger, config: this.config, clients: this.siteConfig.clients }).applyOwnerDocument(current);
    } catch (error) {
      this.logger?.error({ err: error.message, version: current?.version }, 'Could not apply the owner document to coins');
    }
  }

  /**
   * A new entitlement version: apply it (above), and push the masked public
   * view when the apply did not already push one.
   */
  async onEntitlementsChange(current) {
    const result = await this.applyOwner(current);
    const pushed = result && (result.applied?.length || result.template);
    if (!pushed) await this.siteConfig.pushPublic({ features: await this.publicList() });
    return result;
  }

  /** The boot-time SITE_TEMPLATE, queued behind any owner template being applied. */
  async bootstrapTemplate(requested) {
    return serialiseTemplate(async () => {
      const existing = await this.models.SiteFeature.findByPk(TEMPLATE_ROW, { raw: true, attributes: ['variant'] });
      if (existing) return { existing: resolveTemplateKey(existing.variant), applied: null };
      const out = await this.applyTemplate({ template: requested, enable: true, staff: null });
      return { existing: null, applied: out.applied };
    });
  }

  /** The row with its secrets OPENED. Server-side use only. */
  async resolved(feature) {
    const row = await this.models.SiteFeature.findByPk(feature, { raw: true });
    if (!row) return null;
    const box = this.#secretBox();
    const secrets = Object.fromEntries(Object.entries(row.secrets ?? {}).map(([k, v]) => [k, box.open(v)]));
    return { ...row, secrets };
  }

  /**
   * The push transport this site is configured for right now, or null.
   * Called per send — see the note on the class.
   */
  async pushProvider() {
    const row = await this.resolved('push_notifications');
    if (!row?.enabled || row.variant !== 'onesignal') return null;
    if (!row.config?.appId || !row.secrets?.apiKey) return null;
    return new OneSignalProvider({
      appId: row.config.appId,
      apiKey: row.secrets.apiKey,
      segment: row.config.segment,
      logger: this.logger,
      fetchImpl: this.fetchImpl,
    });
  }

  async test({ feature, userId, title, body, staff }) {
    if (feature !== 'push_notifications') throw errors.NOT_TESTABLE({ feature });
    const provider = await this.pushProvider();
    if (!provider) throw errors.NOT_ENABLED({ feature, hint: 'switch on the OneSignal variant with an App ID and REST API key first' });

    const message = { title, body, type: 'general', data: { test: 'true' } };
    try {
      const result = userId
        ? await provider.sendToUsers([userId], message)
        : await provider.sendToSegment(message);
      this.logger?.warn({ staffId: staff?.id, userId: userId ?? null, accepted: result.accepted }, 'Push connection test sent');
      return { ...result, target: userId ? { userId } : { segment: provider.segment } };
    } catch (error) {
      throw errors.PROVIDER_FAILED({ provider: provider.name, reason: error.message });
    }
  }
}

module.exports = { FeaturesService, TEMPLATE_ROW, describeTemplate };
