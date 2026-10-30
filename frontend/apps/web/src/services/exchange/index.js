/* The exchange's service layer — mssports at /api/v1/sports/user. Endpoint → function → shape map:
 * docs/exchange.md. Each function's JSDoc documents its normalised return shape. */
export { exchangeRequest, ExchangeError, EXCHANGE_BASE, POLL_TIMEOUT_MS, unwrapFeed } from './api';
export {
  getSportEvents,
  getSportsTree,
  getLatestEvents,
  getMatchMarkets,
  getMatchHeader,
  getScoreUrl,
  getVirtualEventMedia,
  isGoneBody,
} from './feed';
export {
  getBettingConfig,
  leagueKeyOf,
  bufferCategoryOf,
  bufferMarketKeyOf,
  getSportsBufferSeconds,
  getSportsMaxOddsRule,
  peekVirtualLimit,
  applyVirtualLimits,
  resetBettingConfigCache,
} from './config';
export {
  fetchEventLimits,
  peekEventLimits,
  applyLimitOverride,
  applyEventLimits,
  resetEventLimitsCache,
} from './eventLimits';
export {
  placeBet,
  placeCombinedBet,
  getBetResult,
  savePendingBet,
  clearPendingBet,
  reconcilePendingBets,
  BET_PLACED_EVENT,
  announceBetPlaced,
} from './bets';
export { getMatchExposure, getOpenBets, getFancyBets } from './positions';
export { getSportsBets, getAccountStatement, getStatementMarketBets } from './history';
export {
  DEFAULT_STAKE_BUTTONS,
  DEFAULT_ONE_CLICK_BUTTONS,
  getStakeButtons,
  saveStakeButtons,
  getOneClickButtons,
  saveOneClickButtons,
} from './stakes';
