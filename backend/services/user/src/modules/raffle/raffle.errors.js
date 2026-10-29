'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('RAFFLE', {
  /** The site admin has the raffle switched off. */
  DISABLED: { status: 403, message: 'The raffle is not running right now' },
  /** One free ticket per player per draw. */
  ALREADY_CLAIMED: { status: 409, message: 'You already have your free ticket for this draw' },
  DRAW_NOT_FOUND: { status: 404, message: 'No such draw' },
  /** The running draw was made early; tickets open again with the next one. */
  DRAW_CLOSED: { status: 409, message: "This week's draw has already been made" },
  /** Running a draw by hand that has already been drawn. */
  ALREADY_DRAWN: { status: 409, message: 'This draw has already been made' },
});
