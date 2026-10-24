'use strict';

const { Router } = require('express');
const { validate, createActivityRecorder, imageUpload } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../blogs.validators');
const { BlogsService } = require('../blogs.service');
const { createControllers } = require('../controllers');
const errors = require('../blogs.errors');

/** Blog failures read as `BLOGS_*`, not as a shared namespace. */
const single = (field) => imageUpload.singleImage({ field, errors });

/**
 * Writing the site's content.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ALL FIVE OF THESE WERE UNAUTHENTICATED
 *
 *     router.post('/uploadImage',    upload.single('image'), …)
 *     router.post('/createBlog',     upload.single('image'), …)
 *     router.post('/updateBlog',     …)
 *     router.post('/deleteBlog',     …)
 *     router.post('/deleteBlogById', …)
 *
 * Not one middleware between them. `legacy/index.js` never requires the
 * router, and that is the only reason it was not exploited.
 *
 * `config:write` and an audit row are the fix. The audit row matters as much as
 * the guard: the first question after a page is found to have been altered is
 * who altered it, and legacy could not answer that even in principle.
 *
 * Note the ORDER on the two multipart routes — the permission check runs before
 * multer, so an unauthenticated request never has its body read, let alone
 * buffered. Legacy ran multer first and had nothing after it.
 * ═════════════════════════════════════════════════════════════════════════
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const ctrl = createControllers({ service: new BlogsService(deps) });

  const withActivity = createActivityRecorder({
    client: clients.admin,
    logger,
    serviceName: config.SERVICE_NAME,
  });

  const router = Router();
  const canWrite = auth.requirePermission(PERMISSIONS.CONFIG_WRITE);

  /**
   * @legacy POST /createBlog
   * @legacy POST /uploadImage
   *
   * The standalone image upload is folded in. It wrote bytes to a
   * publicly-served directory with no row pointing at them, so nothing could
   * ever find or clean up an orphan. An image belongs to a post here.
   */
  router.post(
    '/',
    canWrite,
    ...single('image'),
    validate(v.create),
    withActivity({
      action: 'blog.create',
      describe: (req) => ({
        targetType: 'BLOG',
        targetId: null,
        details: {
          title: req.body.title,
          published: req.body.isPublished === true || req.body.isPublished === 'true',
          bytes: req.file?.size ?? null,
        },
      }),
    }),
    ctrl.create
  );

  /**
   * @legacy POST /updateBlog?id=… (or body id — legacy accepted either)
   */
  router.patch(
    '/:id',
    canWrite,
    ...single('image'),
    validate(v.update),
    withActivity({
      action: 'blog.update',
      describe: (req) => ({
        targetType: 'BLOG',
        targetId: req.params.id,
        details: {
          // What was asked to change, without the article body in the audit log.
          fields: Object.keys(req.body ?? {}),
          bytes: req.file?.size ?? null,
        },
      }),
    }),
    ctrl.update
  );

  /**
   * @legacy POST /deleteBlogById?id=5
   * @legacy POST /deleteBlog — body: { slug }
   *
   * Two routes because legacy deleted by two different keys and clients may
   * hold either. One service method behind them.
   */
  router.delete(
    '/:id',
    canWrite,
    validate(v.removeById),
    withActivity({
      action: 'blog.delete',
      describe: (req) => ({ targetType: 'BLOG', targetId: req.params.id, details: {} }),
    }),
    ctrl.removeById
  );

  router.delete(
    '/slug/:slug',
    canWrite,
    validate(v.removeBySlug),
    withActivity({
      action: 'blog.delete',
      describe: (req) => ({ targetType: 'BLOG', targetId: req.params.slug, details: { by: 'slug' } }),
    }),
    ctrl.removeBySlug
  );

  return router;
};
