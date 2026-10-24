'use strict';

const { imageUpload } = require('@ibitplay/common');

/**
 * Accepting a P2P image.
 *
 * Four uploads in this module, and every one of them is EVIDENCE in a dispute
 * over real money:
 *
 *   payment proof    the buyer's screenshot showing they sent the fiat
 *   admin proof      the operator's screenshot showing they paid a seller out
 *   QR image         the seller's receiving code
 *   dispute shot     whatever the complainant is pointing at
 *
 * Legacy took all four with `multer.diskStorage` and stored `req.file.filename`
 * in a VARCHAR — see `legacy/peerTrade/middleware.js`, nine lines with no
 * `fileFilter` at all, so not even the client's own claim about the type was
 * checked. Any file, any name, straight to disk.
 *
 * The bytes go in the row (migration 033) after a content check, so the
 * evidence survives a restart and cannot be an HTML document.
 *
 * `MAX_UPLOAD_BYTES` is re-exported because `p2p.errors` quotes it in a
 * message and importing `@ibitplay/common` there would be a cycle through this
 * module's own error set.
 */

const { MAX_UPLOAD_BYTES } = imageUpload;

/** Inspect a P2P upload, throwing in the `P2P` namespace. */
function inspect(file, errors) {
  return imageUpload.inspect(file, errors);
}

/** The middleware pair a P2P upload route uses. */
function single(field, errors) {
  return imageUpload.singleImage({ field, errors });
}

module.exports = { MAX_UPLOAD_BYTES, inspect, single, sniff: imageUpload.sniff };
