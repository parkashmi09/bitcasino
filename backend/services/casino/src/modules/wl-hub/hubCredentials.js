'use strict';

const { hubLink } = require('@ibitplay/common');
const { createSecretBox } = require('@ibitplay/auth');

/** casino-service's side of the hub link (common/hubLink) with this site's secret box. */
const withBox = (deps) => ({ ...deps, box: createSecretBox({ config: deps.config, logger: deps.logger }) });

module.exports = {
  callParent: (deps, method, path, body, options) => hubLink.callParent(withBox(deps), method, path, body, { service: 'casino', ...options }),
  requireParent: (deps) => hubLink.requireParent(withBox(deps)),
  authenticateCopy: (deps) => hubLink.authenticateCopy(withBox(deps)),
  whitelabelById: (deps, id) => hubLink.whitelabelById(withBox(deps), id),
  callCopy: (wl, method, path, body, options) => hubLink.callCopy(wl, method, path, body, { service: 'casino', ...options }),
  resetHubCache: hubLink.resetHubCache,
};
