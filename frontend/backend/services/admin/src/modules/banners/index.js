'use strict';

/**
 * Banners — the images on the front of the site.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * BOTH UPLOAD ROUTES WERE UNAUTHENTICATED
 *
 *     router.post('/createBanner', upload.single('image'), async (req, res) => {
 *     router.post('/updateBanner', upload.single('image'), async (req, res) => {
 *
 * No middleware, on a router mounted at `/api/banners`. Anyone who could reach
 * the port could write a file to the API server's disk and replace the image on
 * the platform's home page. Two things follow from that, and the second is the
 * one that matters:
 *
 *   - the banner itself. A casino home page is a payment funnel; replacing its
 *     hero image with one pointing somewhere else is a phishing page with the
 *     operator's own domain in the address bar.
 *
 *   - the disk. Every accepted upload was written permanently under
 *     `Banners/banners/`, with no quota and no cleanup. A loop over the same
 *     endpoint fills the volume the database is on.
 *
 * The extension filter (`.png/.jpg/.jpeg`) was the only check and it read
 * `file.originalname` — the client's own claim about what it was sending. The
 * bytes were never looked at.
 *
 * ── AND WHAT THE ROUTES DID TO EACH OTHER ────────────────────────────────
 *
 * `createBanner` INSERTed unconditionally, so uploading twice for the same
 * placement left the first row behind — invisible to `getBannerByType`, which
 * takes only the newest, but listed forever by `getBannerAll`.
 *
 * `updateBanner` then ran `UPDATE banners SET image=$2 WHERE type=$1` with no
 * LIMIT, rewriting EVERY row of that type, after unlinking the file belonging
 * to only ONE of them. The rest kept pointing at a file that was still on disk
 * under a name nothing referenced. Migration 027 collapses the pile.
 *
 * ── WHERE THE BYTES LIVE NOW ─────────────────────────────────────────────
 *
 * In the row. Local disk is not shared between replicas, so an upload that
 * landed on one server was a 404 from the next, intermittently. See migration
 * 027 — there is no object store configured anywhere in this repository, and
 * a handful of images belong in the row that already describes them.
 */
module.exports = {
  name: 'banners',
  service: 'admin',
  basePath: '/banners',
  models: ['admin'],
  routers: {
    // Reading a banner is what every visitor's browser does before login.
    public: require('./routes/public.routes'),
    admin: require('./routes/admin.routes'),
  },
};
