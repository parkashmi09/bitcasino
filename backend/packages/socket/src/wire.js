'use strict';

/**
 * The socket wire format.
 *
 * Lifted from `legacy/General/Buffer/index.js`, which is what every shipped
 * client encodes and decodes with:
 *
 *     B.encode = (data) => Buffer.from(JSON.stringify(data), 'binary');
 *     B.decode = (data) => JSON.parse(new TextDecoder().decode(data));
 *
 * It is JSON in a Buffer. Not a compression, not an encryption — the payload is
 * readable in a packet capture. Worth stating because the obfuscated event
 * names give an impression of secrecy that the transport does not support, and
 * somebody will eventually reason from "it's encoded" to "it's safe to put a
 * secret in it".
 *
 * ── THE THREE THINGS THAT CHANGE ─────────────────────────────────────────
 *
 * 1. `'binary'` IS A LIE ABOUT THE ENCODING. `Buffer.from(str, 'binary')` is
 *    latin1: it keeps the low byte of each UTF-16 code unit and DISCARDS the
 *    rest. The decoder is `TextDecoder`, which is UTF-8. So any non-ASCII
 *    character — a player named `José`, a chat message in Hindi, an emoji —
 *    is mangled on the way out and either arrives corrupted or throws inside
 *    `JSON.parse`. Legacy swallowed that throw and returned `undefined`, so
 *    the event silently did nothing.
 *
 *    `'utf8'` here, which is what the decoder has always expected.
 *
 * 2. A DECODE FAILURE IS AN ERROR, NOT `undefined`. Legacy caught, logged to
 *    stdout and returned nothing, so every caller then destructured
 *    `undefined` and threw somewhere unrelated — or worse, read `undefined`
 *    as a missing field and carried on.
 *
 * 3. THERE IS A SIZE LIMIT. Legacy had none, on a socket anyone could open.
 */

const errors = require('./socket.errors');

/** 256 KB. A chat message is bytes; nothing legitimate here approaches this. */
const MAX_FRAME_BYTES = 256 * 1024;

/**
 * Encode a payload for the wire.
 *
 * Returns `null` for a falsy payload, matching legacy — several handlers emit
 * `encode(result)` where `result` can be `false`, and the clients treat a null
 * frame as "no data" rather than erroring.
 */
function encode(data) {
  if (!data) return null;
  return Buffer.from(JSON.stringify(data), 'utf8');
}

/**
 * Decode a frame from a client.
 *
 * @throws {AppError} on anything that is not a JSON object within the limit.
 */
function decode(frame) {
  if (frame === null || frame === undefined) return null;

  const buffer = Buffer.isBuffer(frame)
    ? frame
    : ArrayBuffer.isView(frame)
      ? Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength)
      : typeof frame === 'string'
        ? Buffer.from(frame, 'utf8')
        : null;

  /**
   * Socket.io will happily deliver an already-parsed object if the client sent
   * JSON rather than a Buffer. Accepting it is not laxity — some legacy
   * clients do exactly that, and rejecting them would break working sessions.
   */
  if (!buffer) {
    if (typeof frame === 'object') return frame;
    throw errors.BAD_FRAME({ type: typeof frame });
  }

  if (buffer.length > MAX_FRAME_BYTES) {
    throw errors.FRAME_TOO_LARGE({ bytes: buffer.length, max: MAX_FRAME_BYTES });
  }

  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch (error) {
    // The frame itself is NOT logged — it is attacker-controlled and may be
    // large or hostile. Its length is enough to diagnose with.
    throw errors.BAD_FRAME({ bytes: buffer.length });
  }
}

module.exports = { encode, decode, MAX_FRAME_BYTES };
