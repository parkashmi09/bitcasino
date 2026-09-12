'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const E = require('./clubBroadcasts.errors');
const { IMAGE_TYPES, MAX_IMAGE_BYTES } = require('./clubBroadcasts.constants');

/**
 * Where club banner images live, and the only way to read one back.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * `GET /clubs/banner-image/:imagePath(*)` WAS A PATH TRAVERSAL
 *
 *     const imagePath = req.params.imagePath;
 *     const fullPath = path.join(
 *       '/var/www/html/hellogames/ibitplay/backend/clubmembership/clubbanners/images',
 *       imagePath
 *     );
 *     ...
 *     res.send(await fs.readFile(fullPath));
 *
 * `:imagePath(*)` is a WILDCARD — it matches slashes — and `path.join` resolves
 * `..` segments happily. There was no containment check and no authentication.
 *
 *     GET /clubbanner/clubs/banner-image/../../../../../../etc/passwd
 *
 * read and returned any file the process could open. On this deployment that
 * includes `legacy/.env`, the committed Firebase service-account key, and the
 * source of every file with a hard-coded credential in it.
 *
 * `resolve()` below is the fix: the path is resolved to an absolute location
 * and then checked to be INSIDE the root. That check has to be on the resolved
 * path — rejecting the string `..` is not enough, because `%2e%2e`, a symlink,
 * and an absolute path all get past a string check and none of them get past
 * this one.
 */
class BannerImageStore {
  constructor({ root, logger }) {
    // Resolved once, at construction. Comparing against a relative root is how
    // a containment check silently stops containing anything.
    this.root = path.resolve(root);
    this.logger = logger;
  }

  /**
   * A stored path (`<clubKey>/<name>.png`) → an absolute path inside the root.
   *
   * Throws `IMAGE_NOT_FOUND` for anything that escapes — the same error as a
   * genuinely missing file, so the endpoint cannot be used to probe the host.
   */
  resolve(storedPath) {
    const raw = String(storedPath ?? '');

    // A NUL byte truncates the path at the filesystem layer, which is a way to
    // make a suffix check pass and then open something else.
    if (raw.includes('\0')) throw E.IMAGE_NOT_FOUND();

    const full = path.resolve(this.root, raw);

    // The separator matters: `/srv/images-evil` starts with `/srv/images`.
    if (full !== this.root && !full.startsWith(this.root + path.sep)) {
      this.logger?.warn({ requested: raw.slice(0, 200) }, 'REFUSED banner image request: outside the storage root');
      throw E.IMAGE_NOT_FOUND();
    }

    return full;
  }

  /** Read a stored image, or throw. */
  async read(storedPath) {
    const full = this.resolve(storedPath);

    try {
      const stat = await fs.stat(full);
      // A directory, a socket or a symlink to one is not an image. `stat`
      // follows symlinks, so a link pointing outside the root fails here even
      // though its own path is inside it.
      if (!stat.isFile()) throw E.IMAGE_NOT_FOUND();

      const buffer = await fs.readFile(full);
      const type = detectType(buffer);
      if (!type) throw E.IMAGE_NOT_FOUND();

      return { buffer, contentType: type };
    } catch (error) {
      if (error?.code === 'CLUBCAST_IMAGE_NOT_FOUND') throw error;
      throw E.IMAGE_NOT_FOUND();
    }
  }

  /**
   * Store an uploaded image under a club.
   *
   * The filename is generated, never taken from the upload — a client-supplied
   * name is the other half of a traversal, and legacy used
   * `${uniqueClubId}/${imageName}` with the name from the request.
   */
  async write({ clubKey, buffer }) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw E.IMAGE_TYPE_NOT_ALLOWED();
    if (buffer.length > MAX_IMAGE_BYTES) throw E.IMAGE_TOO_LARGE({ bytes: buffer.length, max: MAX_IMAGE_BYTES });

    /**
     * The type comes from the CONTENT, not from a header or an extension.
     * A file called `x.png` that is actually HTML is served as HTML by anything
     * that trusts the extension, and that is a stored cross-site script.
     */
    const contentType = detectType(buffer);
    if (!contentType) throw E.IMAGE_TYPE_NOT_ALLOWED();

    // The club key is ours, not the caller's, but it still ends up in a path —
    // so it is constrained to characters that cannot mean anything else.
    const safeKey = String(clubKey).replace(/[^A-Za-z0-9_-]/g, '');
    if (!safeKey) throw E.IMAGE_TYPE_NOT_ALLOWED();

    const name = `${crypto.randomBytes(16).toString('hex')}${IMAGE_TYPES[contentType].ext}`;
    const stored = `${safeKey}/${name}`;
    const full = this.resolve(stored);

    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, buffer);

    return { storedPath: stored, contentType, bytes: buffer.length };
  }

  /** Best-effort removal. A missing file is not an error worth propagating. */
  async remove(storedPath) {
    try {
      await fs.unlink(this.resolve(storedPath));
    } catch (error) {
      this.logger?.debug({ err: error, storedPath }, 'Banner image could not be removed');
    }
  }
}

/** Magic bytes → content type, or null. */
function detectType(buffer) {
  for (const [contentType, spec] of Object.entries(IMAGE_TYPES)) {
    const headMatches = spec.magic.some((signature) =>
      signature.every((byte, index) => buffer[index] === byte)
    );
    if (!headMatches) continue;

    // WebP needs its format tag at offset 8 as well as the RIFF header.
    if (spec.at8 && !spec.at8.every((byte, index) => buffer[8 + index] === byte)) continue;

    return contentType;
  }
  return null;
}

module.exports = { BannerImageStore, detectType };
