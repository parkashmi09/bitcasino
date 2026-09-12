'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('CLUB', {
  CLUB_NOT_FOUND: { status: 404, message: 'Club not found' },
  CLUB_INACTIVE: { status: 410, message: 'This club is no longer accepting members' },
  CLUB_FULL: { status: 409, message: 'This club has reached its member limit' },
  USER_NOT_FOUND: { status: 404, message: 'Player not found' },

  NOT_CLUB_OWNER: {
    status: 403,
    message: 'Only the club owner can do that',
  },
  NOT_A_MEMBER: { status: 404, message: 'This player is not in a club' },
  ALREADY_IN_CLUB: {
    status: 409,
    // A player in two clubs would put two owners in line for commission on the
    // same wagering.
    message: 'This player already belongs to a club',
  },
  OWNER_CANNOT_LEAVE: {
    status: 409,
    message: 'A club owner cannot leave their own club',
  },
  CANNOT_RECRUIT_SELF: { status: 422, message: 'You cannot recruit yourself' },

  CODE_REQUIRED: { status: 422, message: 'A club code or an agent code is required' },
  AGENT_NOT_FOUND: { status: 404, message: 'That agent code is not valid' },

  INVALID_ROLE_CHANGE: { status: 422, message: 'That role change is not allowed' },

  HAS_SUB_CLUBS: {
    status: 409,
    // Deleting a parent would orphan its children's hierarchy rows and leave
    // their members reporting to a club that no longer exists.
    message: 'This club has sub-clubs and cannot be deleted',
  },

  PERCENTAGES_EXCEED_TOTAL: {
    status: 422,
    // Legacy stored whatever it was given, so a club could be configured to pay
    // out more than the wagering it generated.
    message: 'The owner, agent and member percentages cannot exceed 100 between them',
  },

  CODE_GENERATION_FAILED: { status: 503, message: 'Could not allocate a code — try again' },
});
