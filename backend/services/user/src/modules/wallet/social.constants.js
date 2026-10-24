'use strict';

/**
 * Tipping, rain and chat rooms.
 */

/**
 * Currencies a tip or a rain may NOT be sent in.
 *
 * Legacy's check, in both `sendTip` and `makeRain`:
 *
 *     if (coin === "nc") return callback({ status: false, msg: "NC is the test coin !" });
 *
 * `nc` is a play-money balance. Moving it between accounts would let players
 * trade something the platform prints.
 */
const TIP_BLOCKED_CURRENCIES = Object.freeze(['NC']);

/**
 * The smallest tip.
 *
 * Legacy had two contradictory floors, one after the other:
 *
 *     if (amount <= 0)         return "Please Enter Currect Amount !";
 *     if (amount <= 0.0000003) return "Minimum amount for tip is 0.00000050";
 *
 * The message says 0.00000050 and the check is 0.0000003 — so amounts between
 * the two were accepted while being told they were not allowed. The message
 * is the intent, so that is the value.
 */
const MIN_TIP = '0.00000050';

/**
 * How many players one rain may reach.
 *
 * Legacy had no ceiling: `allAmount = amount * players` with `players` from
 * the message. A rain is N separate transfers, so an unbounded count is an
 * unbounded amount of work from one message.
 */
const MAX_RAIN_PLAYERS = 50;

/**
 * The chat rooms, mapped to the models that hold them.
 *
 * Chat is genuinely stored per room — `chat_global` and `chat_brazil` are both
 * real tables — so legacy's `"chat_" + room` had a real intent. The defect is
 * that `room` came from the message and was passed through `_.lowerCase`,
 * which formats rather than sanitises. A map means an unknown room is refused
 * and there is no string to build.
 */
const CHAT_ROOMS = Object.freeze({
  global: 'ChatGlobal',
  en: 'ChatGlobal',
  brazil: 'ChatBrazil',
  br: 'ChatBrazil',
  pt: 'ChatBrazil',
});

module.exports = { TIP_BLOCKED_CURRENCIES, MIN_TIP, MAX_RAIN_PLAYERS, CHAT_ROOMS };
