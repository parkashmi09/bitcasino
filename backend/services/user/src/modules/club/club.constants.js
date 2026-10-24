'use strict';

/** Where a player stands in a club. */
const ROLE = Object.freeze({ OWNER: 'owner', AGENT: 'agent', MEMBER: 'member' });

/**
 * Which role changes are permitted.
 *
 * Lifted from `allowedRoleChanges` in the legacy controller, unchanged. Note
 * what is absent: nothing transitions TO or FROM `owner`. Ownership moves by
 * transferring the club, not by editing a membership row, and allowing it here
 * would let a club end up with two owners or none.
 */
const ROLE_TRANSITIONS = Object.freeze({
  [ROLE.MEMBER]: [ROLE.AGENT],
  [ROLE.AGENT]: [ROLE.MEMBER],
  [ROLE.OWNER]: [],
});

/**
 * The alphabet for club and agent codes.
 *
 * No `0`, `O`, `1`, `I` or `L`. These codes are read off a screen and typed by
 * hand, and every one of those pairs is routinely mistyped — a member joining
 * the wrong agent's downline is a support ticket about money.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

/** Named earnings configurations a club can hold. */
const EARNINGS_TYPES = Object.freeze({ DEFAULT: 'default', PROMOTIONAL: 'promotional' });

module.exports = { ROLE, ROLE_TRANSITIONS, CODE_ALPHABET, CODE_LENGTH, EARNINGS_TYPES };
