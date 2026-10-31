'use strict';

const { defineErrors } = require('@ibitplay/common');

/**
 * Every feature's on/off and variant — business model, deposit and withdrawal
 * policies included — is set in the owner panel (docs/OWNER-PANEL.md §2, the
 * entitlement document's `features` and `variants`). Namespace `OWNER`, key
 * `MANAGED`: the wire code is exactly `OWNER_MANAGED`, details `{ feature }`.
 * Staff may still save the config and keys of the variant the owner chose.
 */
module.exports = defineErrors('OWNER', {
  MANAGED: { status: 403, message: 'This setting is managed by the platform' },
});
