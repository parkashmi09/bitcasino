'use strict';

/**
 * @ibitplay/common — the shared foundation every service builds on.
 * Nothing here knows about a specific domain; anything domain-aware belongs in
 * the service that owns it.
 */

const env = require('./env');
const errors = require('./errors');
const money = require('./money');
const { createLogger } = require('./logger');
const { createApp } = require('./createApp');
const { startServer } = require('./server');
const { createHealthRouter } = require('./health');
const { ServiceClient, CircuitBreaker } = require('./serviceClient');
const { WalletClient } = require('./walletClient');
const { Mailer, redact } = require('./mailer');
const { asyncHandler, wrapController } = require('./asyncHandler');
const imageUpload = require('./imageUpload');
const response = require('./response');
const { defineErrors, listErrorCodes, getErrorDefinition } = require('./defineErrors');
const { loadModules, mountModules, collectJobs, collectDomains, AUDIENCES } = require('./moduleLoader');
/**
 * The VIP ladder lives here because TWO services read it: user-service decides
 * a player's bonus from it, and admin-service reports the same level back to
 * an operator. A second copy would drift, and a player told they are VIP 30 on
 * one screen and VIP 29 on another has found a bug in the platform's word.
 */
const { VIP_LEVELS, vipLevelFor } = require('./vipLevels');

const { requestContext, getContext, getRequestId, REQUEST_ID_HEADER } = require('./middleware/requestContext');
const { errorHandler } = require('./middleware/errorHandler');
const { notFound } = require('./middleware/notFound');
const { validate, schemas, z } = require('./middleware/validate');
const { createRateLimiter, configureRateLimitStore, closeRateLimitStore } = require('./middleware/rateLimit');
const { auditProductionConfig, assertProductionPosture } = require('./productionGuards');
const internalAclExports = require('./internalAcl');
const { internalAuth, INTERNAL_KEY_HEADER, INTERNAL_SERVICE_HEADER } = require('./middleware/internalAuth');
const { createActivityRecorder } = require('./middleware/activity');

module.exports = {
  ...require('./cache'),
  // config
  ...env,

  // errors
  ...errors,
  defineErrors,
  listErrorCodes,
  getErrorDefinition,

  // module system — one codebase, four services or one monolith
  loadModules,
  mountModules,
  collectJobs,
  collectDomains,
  AUDIENCES,

  // helpers
  money,
  VIP_LEVELS,
  vipLevelFor,
  createLogger,
  createApp,
  startServer,
  createHealthRouter,
  ServiceClient,
  CircuitBreaker,
  WalletClient,
  Mailer,
  redact,
  asyncHandler,
  wrapController,
  response,
  z,

  /**
   * Image uploads. Three modules across two services take one, and all three
   * carried the same defect — the format judged from the client's declared MIME
   * type or filename, never from the bytes. One signature table, here.
   */
  imageUpload,

  // middleware
  middleware: {
    requestContext,
    errorHandler,
    notFound,
    validate,
    createRateLimiter,
    internalAuth,
    createActivityRecorder,
  },
  requestContext,
  errorHandler,
  notFound,
  validate,
  schemas,
  createRateLimiter,
  configureRateLimitStore,
  closeRateLimitStore,
  auditProductionConfig,
  assertProductionPosture,
  ...internalAclExports,
  internalAuth,
  createActivityRecorder,

  // context
  getContext,
  getRequestId,

  // header names
  REQUEST_ID_HEADER,
  INTERNAL_KEY_HEADER,
  INTERNAL_SERVICE_HEADER,
};
