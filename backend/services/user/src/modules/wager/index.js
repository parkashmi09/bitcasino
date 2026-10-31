'use strict';

/**
 * Wagering requirements (targetX).
 *
 * Replaces the six targetX endpoints buried in
 * `legacy/fiatdeposit/controller.js`, which also ran an `ALTER TABLE` on every
 * request to create the columns they needed.
 */
module.exports = {
  name: 'wager',
  service: 'user',
  basePath: '/wager',
  models: ['core', 'payments', 'extended'],
  routers: {
    user: require('./routes/user.routes'),
    admin: require('./routes/admin.routes'),
    /** Every settlement path counts stakes here, converted to USD. */
    internal: require('./routes/internal.routes'),
  },
  /**
   * Stake reversals sports-service / casino-service could not deliver (their call to
   * `/internal/user/wager/reverse` failed after their void / refund committed) are queued in
   * `wager_reverse_outbox` and replayed here with backoff — idempotent, so always safe.
   */
  jobs: [
    {
      name: 'wager:reverse-outbox',
      intervalMs: Number(process.env.WAGER_REVERSE_OUTBOX_INTERVAL_MS || 60 * 1000),
      immediate: true,
      run: async (container) => {
        const { WagerReverseOutboxService } = require('./reverseOutbox.service');
        return new WagerReverseOutboxService(container).retryPending({
          limit: Number(process.env.WAGER_REVERSE_OUTBOX_BATCH || 100),
        });
      },
    },
  ],
};
