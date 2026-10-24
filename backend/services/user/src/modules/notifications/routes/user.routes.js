'use strict';

const { Router } = require('express');
const { validate, noBody, noQuery } = require('@ibitplay/common');

const v = require('../notifications.validators');
const { NotificationsService } = require('../notifications.service');
const { createControllers } = require('../controllers');

/**
 * The bell in the header, and the phone's notification page.
 *
 * Four routes over three methods that admin-service has carried since the
 * port. Nothing here reads or writes a table.
 */
module.exports = function userRoutes(deps) {
  const service = new NotificationsService(deps);
  const ctrl = createControllers({ service });

  const router = Router();

  router.get('/', validate(v.list), ctrl.list);
  router.get('/unread-count', noQuery(), ctrl.unreadCount);
  router.post('/read-all', noBody(), ctrl.readAll);
  /* AFTER `/read-all`, or Express matches that literal against `:id` and a
     read-all arrives as a request to mark a notification called "read-all". */
  router.post('/:id/read', noBody(), validate(v.readOne), ctrl.readOne);

  return router;
};
