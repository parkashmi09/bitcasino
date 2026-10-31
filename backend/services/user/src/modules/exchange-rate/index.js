'use strict';

/**
 * Exchange rates.
 *
 * Replaces `legacy/exchangerate/`, where the three write endpoints had no
 * authentication at all.
 */
module.exports = {
  name: 'exchange-rate',
  service: 'user',
  basePath: '/exchange-rate',
  models: ['core'],
  routers: {
    public: require('./routes/public.routes'),
    admin: require('./routes/admin.routes'),
    internal: require('./routes/internal.routes'),
  },
  jobs: [
    {
      name: 'exchange-rate:refresh-from-market',
      intervalMs: Number(process.env.EXCHANGE_RATE_REFRESH_MS || 60 * 60 * 1000),
      immediate: true,
      run: async (container) => {
        const { ExchangeRateService } = require('./exchangeRate.service');
        return new ExchangeRateService(container).refreshFromMarket();
      },
    },
  ],
};
