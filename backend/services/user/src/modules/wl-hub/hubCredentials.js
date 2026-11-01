'use strict';

const { hubLink } = require('@ibitplay/common');
const { createSecretBox } = require('@ibitplay/auth');

/**
 * user-service's side of the hub link (common/hubLink) with this site's secret box. The parent's
 * user-service takes payments (`/api/v1/user/wl-hub`); casino-service has its own wl-hub module.
 */

const withBox = (deps) => ({ ...deps, box: createSecretBox({ config: deps.config, logger: deps.logger }) });

module.exports = {
  parentHub: (deps) => hubLink.parentHub(withBox(deps)),
  callParent: (deps, method, path, body) => hubLink.callParent(withBox(deps), method, path, body),
  requireParent: (deps) => hubLink.requireParent(withBox(deps)),
  authenticateCopy: (deps) => hubLink.authenticateCopy(withBox(deps)),
  whitelabelById: (deps, id, transaction) => hubLink.whitelabelById(withBox(deps), id, transaction),
  callCopy: (wl, method, path, body) => hubLink.callCopy(wl, method, path, body),
  resetHubCache: hubLink.resetHubCache,
};
