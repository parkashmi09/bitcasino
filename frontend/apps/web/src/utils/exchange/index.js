/* The exchange's pure logic — what screens import. Addaplay wins wherever it has a formula;
 * TENEXCH fills the rest. The per-function source and every Addaplay/TENEXCH difference are in
 * docs/exchange.md. Import from here, not from the individual files. */

// Slip maths, stake rules, favour, rate cap, bet rows — Addaplay
export {
  ODDS_EPSILON,
  addaplayMarketTitle,
  calculateProfit,
  slipProfitLoss,
  calculateExposurePerSelection,
  slipExposureRows,
  ADDAPLAY_MIN_BET,
  validateMinBetAmount,
  validateStakeRange,
  resolveStakeLimits,
  validateUnmatchedOdds,
  isVirtualEvent,
  ADDAPLAY_DEFAULT_BUFFER_SECONDS,
  getBufferSeconds,
  isLockedOddsMarket,
  isFavourEligible,
  readLiveSide,
  evaluateBookieFavour,
  FANCY_DRIFT_TOLERANCE,
  isFancyDriftAcceptable,
  resolveGameType,
  RATE_CAP,
  isRateCapped,
  violatesRateCap,
  betMarketKey,
  beginBetSubmit,
  endBetSubmit,
  betProfit,
  normaliseBet,
  normaliseBets,
  formatOddAddaplay,
  getRowStatus,
} from './addaplay';

// Slip composition (Addaplay order + TENEXCH payload for mssports)
export {
  SPORT_NAME_BY_SID,
  buildBetValue,
  isOddsEditable,
  prevalidateBet,
  isRacingSid,
  stakeLimits,
  newClientRef,
  buildPlaceRequest,
} from './betFlow';

// Feed shaping, classification, suspension, display — TENEXCH (+ ball running)
export {
  formatOdd,
  formatSize,
  formatMax,
  formatBookValue,
  formatPL,
  formatStake,
  formatAmount,
  applyMatchOddsLimits,
  feedMaxStake,
  classifyMarket,
  isMarketSuspended,
  isSectionSuspended,
  isBallRunning,
  calculateRunnerPL,
} from './oddsHelpers';

// Payload, books, liability — TENEXCH
export {
  oddsFormat,
  prepareBetPayload,
  calculateSingleBetPLValue,
  calculateMatchOddsResults,
  calculateFancyResults,
  calculateTiedMatchResults,
  calculateMarketLiability,
} from './betHelpers';

// Rules: tick ladder, odds field, market family, limits constants — TENEXCH
export {
  normalizeName,
  isLaySide,
  showsAsLay,
  panelSideClass,
  feedSideFor,
  calcPL,
  calcProfit,
  showsZeroProfit,
  MARKET_FAMILY,
  normalizeMarketKey,
  getMarketFamily,
  hasRunnerBook,
  isCricketLimitedOvers,
  maxOddsBlockScope,
  isOddsLockedByType,
  isBookmakerStyle,
  ODDS_FIELD,
  getOddsFieldMode,
  isKhadoPanel,
  namesOwnLine,
  stepKhadoLine,
  stepOdds,
  isBlockedGameStatus,
  suspensionToastMessage,
  MIN_BET_AMOUNT,
  VIRTUAL_MIN_BET_AMOUNT,
  BET_ERROR,
  getBetValidationError,
} from './placeBetRules';

export { monitorOddsBuffer, getFinalSuspensionStatus, checkFancyOddsDrift } from './placeBetLiveChecks';
export { registerBetAttempt } from './betAttemptTracker';
export {
  isBookieFavourMarket,
  manualBetGate,
  manualBetLiveCheck,
  autoBetCheck,
} from './bookieFavour';
export {
  isCashoutEligibleMarket,
  pickBestPrices,
  buildMarketCashout,
  cashoutToastMessage,
  marketHasCashoutPosition,
  computeCashoutClick,
} from './cashoutUtil';
export { mapMatchExposures } from './exposureMapping';
export { isTossDone, battingFirstSide, tossMarketRows } from './tossState';
export { BET_TOAST } from './betToastMessages';
export { exchangeCode, makeStakeCurrency, niceStake } from './stakeCurrency';
