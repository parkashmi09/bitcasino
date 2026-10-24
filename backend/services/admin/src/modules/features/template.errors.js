'use strict';

const { defineErrors } = require('@ibitplay/common');

/**
 * The template is the owner's choice (docs/OWNER-PANEL.md §2, the entitlement
 * document's `template`). Namespace `TEMPLATE`, key `OWNER_ONLY`: the wire code
 * is exactly `TEMPLATE_OWNER_ONLY`. A single feature's variant is still the
 * site's to change, within the plan.
 */
module.exports = defineErrors('TEMPLATE', {
  OWNER_ONLY: { status: 403, message: 'The site template is set by the platform' },
});
