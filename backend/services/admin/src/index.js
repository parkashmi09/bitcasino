'use strict';

const { startServer, featureCatalogue } = require('@ibitplay/common');

const config = require('./config');
const { createContainer } = require('./container');
const { buildApp } = require('./app');
const { attachSockets } = require('./sockets');
const { FeaturesService } = require('./modules/features/features.service');
const { startPushScheduler } = require('./modules/push/push.scheduler');
const { brandingStore } = require('./modules/branding/branding.store');

/**
 * A fresh database becomes THIS site.
 *
 * One backend serves every site; what makes one deployment differ from the
 * next is the feature variants in `site_features` — and the VIP ladder, which
 * follows the `vip` variant. The template is the OWNER's choice: the
 * entitlement document's `template` wins whenever it names one (the store's
 * onChange applies a new one; this applies it once at boot in case the last
 * attempt failed). `SITE_TEMPLATE` only seeds a database that has never had a
 * template at all. Either may hold an old name (`stake`, …): both resolve
 * through `resolveTemplateKey`.
 */
async function bootstrapSite(container) {
  const features = new FeaturesService(container);
  const template = container.config.SITE_TEMPLATE;
  if (template) {
    const { existing, applied } = await features.bootstrapTemplate(template);
    if (applied) container.logger.warn({ template: featureCatalogue.resolveTemplateKey(template), features: applied.length }, 'SITE_TEMPLATE applied to a fresh site');
    else if (existing !== featureCatalogue.resolveTemplateKey(template)) container.logger.info({ template, applied: existing }, 'SITE_TEMPLATE differs from the template this site runs — the stored one stands');
  }
  // The owner's document (variants + on/off; an older one: its template).
  await features.applyOwner(container.entitlementsStore.current());
  // The owner's branding images, loaded by content hash (a failed load is retried here).
  brandingStore(container).sync(container.entitlementsStore.current().branding);
}

async function main() {
  const container = await createContainer();

  /**
   * The owner's entitlements, from the table, before anything reads them. A
   * new version (an owner save, or one another process stored) applies the
   * owner's document to site_features (every feature's variant and on/off —
   * the site admin only shows them), and re-pushes the (masked) public flags
   * and features down the player sockets — the same `siteConfigUpdated` /
   * `featuresUpdated` an operator's save sends.
   */
  await container.entitlementsStore.start({
    onChange: async (current) => {
      await new FeaturesService(container).onEntitlementsChange(current);
      // A new version may name new branding images: load them (by hash) before players ask.
      await brandingStore(container).sync(current.branding);
    },
  });

  await bootstrapSite(container);
  const app = buildApp(container);

  // Scheduled push campaigns (modules/push).
  const pushScheduler = startPushScheduler(container);

  const { server } = startServer({
    app,
    port: config.PORT,
    serviceName: config.SERVICE_NAME,
    logger: container.logger,
    onShutdown: [() => container.entitlementsStore.stop(), () => pushScheduler.stop(), () => container.close()],
  });

  // The operator console is a socket surface; see `sockets.js` for why the
  // moderation events live on user-service's transport instead.
  const sockets = attachSockets({ server, container });
  container.onShutdown = () => sockets.close();
}

main().catch((error) => {
  console.error('admin-service failed to start:', error.message);
  if (error.name !== 'EnvValidationError') console.error(error.stack);
  process.exit(1);
});
