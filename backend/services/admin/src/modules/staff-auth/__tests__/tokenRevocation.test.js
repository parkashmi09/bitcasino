'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { StaffAuthService } = require('../staffAuth.service');

/**
 * Logout ends the staff account's sessions by bumping `staff.token_version`
 * (the auth guard compares it with the token's `tv`), or an executive's by
 * bumping `executives.token_version` (`etv`). Mocked models, no DB.
 */

const config = { JWT_ACCESS_SECRET: 'test-access-secret-0123456789', JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789' };

test("logout bumps the staff row's token_version, or only the executive's for an executive", async () => {
  const updates = [];
  const execUpdates = [];
  const models = {
    Staff: { update: async (patch, opts) => updates.push({ patch, opts }) },
    Executives: { update: async (patch, opts) => execUpdates.push({ patch, opts }) },
  };
  const service = new StaffAuthService({ models, config });

  await service.logout({ actor: { id: 5, executiveId: null } });
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].opts, { where: { id: 5 } });
  assert.match(String(updates[0].patch.token_version.val), /token_version \+ 1/);

  await service.logout({ actor: { id: 5, executiveId: 9 } });
  assert.equal(updates.length, 1, "an executive's logout must not sign its parent out");
  assert.deepEqual(execUpdates[0].opts, { where: { id: 9 } });
});
