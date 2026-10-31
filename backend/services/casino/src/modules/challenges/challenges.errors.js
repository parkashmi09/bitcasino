'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('CHALLENGE', {
  NOT_FOUND: { status: 404, message: 'No such running challenge' },
  UNKNOWN_GAME: { status: 422, message: 'Pick a game from the catalogue' },
  BAD_DATES: { status: 422, message: 'The challenge must end after it starts' },
});
