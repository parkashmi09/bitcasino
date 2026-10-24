'use strict';

/**
 * Blogs — the platform's content pages.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * `legacy/Blogs/blogroutes.js` IS NEVER MOUNTED, and its five write endpoints
 * have no authentication of any kind. That combination is the whole story:
 * anyone reaching the port could have published, rewritten or deleted any page
 * on the site, and the only thing preventing it was that `index.js` does not
 * require the file.
 *
 * The upload was the sharp end. `fileFilter` trusted `file.mimetype` — the
 * client's declared Content-Type — and the stored filename took its extension
 * from `file.originalname`, the client's own filename. Declare `image/png`,
 * name it `x.html`, and the bytes land in a statically-served directory on the
 * platform's origin. Stored XSS on the main domain by unauthenticated POST.
 *
 * The port reads magic bytes and stores what it detected (`banners/upload.js`,
 * reused), keeps the bytes in the row (migration 032, same reasoning as 027 for
 * banners), and puts `config:write` plus an audit row in front of every write.
 *
 * Smaller things fixed on the way: slugs no longer carry `Date.now()` and no
 * longer change when a headline typo is fixed; the public list is paged; a post
 * can be a draft; `POST /uploadImage` is gone as a standalone route because an
 * image with no post pointing at it can never be cleaned up.
 *
 * WHY THE ADMIN SERVICE: this is site content, managed by staff, alongside
 * `banners` and `site-config`. The public read routes carry no guard — a blog
 * exists to be read by people who are not logged in — but they are the same
 * module, mounted at the same base path.
 * ─────────────────────────────────────────────────────────────────────────
 */
module.exports = {
  name: 'blogs',
  service: 'admin',
  basePath: '/blogs',
  models: ['admin'],
  routers: {
    public: require('./routes/public.routes'),
    admin: require('./routes/admin.routes'),
  },
};
