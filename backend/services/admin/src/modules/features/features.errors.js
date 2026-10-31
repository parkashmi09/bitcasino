'use strict';

const { defineErrors, entitlements } = require('@ibitplay/common');

module.exports = Object.freeze({
  /**
   * The owner has not put this feature in the site's plan (docs/OWNER-PANEL.md
   * §4). Shared with site-config and the player guards, so the wire code is the
   * one `NOT_ENTITLED` everywhere; details `{ kind: 'feature', key }`.
   */
  NOT_ENTITLED: entitlements.entitlementErrors.ENTITLED,
  ...defineErrors('FEATURES', {
  UNKNOWN_FEATURE: { status: 404, message: 'There is no such feature in the catalogue' },
  UNKNOWN_VARIANT: { status: 422, message: 'That feature has no such variant' },
  UNKNOWN_TEMPLATE: { status: 422, message: 'There is no such site template' },
  /**
   * A config or secret key the chosen variant does not declare. Refused rather
   * than stored, for the reason site-config's flag endpoint allow-lists: a
   * write that accepts any key is a write that stores whatever the body says.
   */
  UNEXPECTED_FIELD: { status: 422, message: 'That field does not belong to this variant' },
  MISSING_FIELD: { status: 422, message: 'This variant needs a value that was not given' },
  INVALID_FIELD: { status: 422, message: 'A value does not have the shape this variant expects' },
  NOT_ENABLED: { status: 409, message: 'The feature is not switched on for this site' },
  NOT_TESTABLE: { status: 422, message: 'This feature has no connection test' },
  PROVIDER_FAILED: { status: 502, message: 'The provider refused the request' },
}),
});
