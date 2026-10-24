'use strict';

const { defineErrors } = require('@ibitplay/common');

/**
 * `BONUS_FORFEIT_REQUIRED` — a withdrawal while the player holds an unwagered bonus. Cash may
 * still be withdrawn, but the active bonuses are forfeited: the player confirms by resending with
 * `forfeitBonus: true`. Details `{ count, bonuses: [{ id, amount, currency, remaining }] }`.
 */
const withdraw = defineErrors('BONUS', {
  FORFEIT_REQUIRED: {
    status: 409,
    message: 'You have an active bonus. Withdrawing now forfeits it — confirm to continue.',
  },
});

const admin = defineErrors('PLAYER_BONUS', {
  NOT_FOUND: { status: 404, message: 'Bonus not found' },
  NOT_ACTIVE: { status: 409, message: 'This bonus is no longer active' },
  NOTHING_TO_CLAIM: { status: 409, message: 'Nothing has unlocked yet — keep playing to unlock your bonus' },
});

module.exports = { ...withdraw, ...admin };
