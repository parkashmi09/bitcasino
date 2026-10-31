// constants/pointLedger.js — mssports core, moved unchanged

var POINT_EVENT = {
  USER_CREATION: "User creation",
  // user/staff/owner create hua (opening credit)
  BET_SETTLEMENT: "BET_SETTLEMENT",
  // user ki bet/market settle hui (poori chain me)
  BANK_DEPOSIT: "Bank Deposite",
  // parent ne child ko diya (sirf normal deposit)
  BANK_WITHDRAW: "Bank Withdraw",
  // parent ne child se liya (sirf normal withdraw)
  CREDIT: "Credit",
  // sirf settlement me: parent ne child ko diya (+)
  DEBIT: "Debit",
  // sirf settlement me: parent ne child se liya (−)
  MANUAL_ADJUSTMENT: "MANUAL_ADJUSTMENT",
  // admin correction (API se, DB se nahi)
  REVERSAL: "REVERSAL",
  // galat entry ka ulta — original kabhi delete nahi hoti
  // Sports win commission (owner cell ON): jeet ke baad alag '- Comm' entry, poori
  // chain me settlement jaisa hi (docs/plans/2026-09-09-sports-win-commission.md)
  COMMISSION: "COMMISSION"
};
var POINT_EVENT_TYPES = Object.values(POINT_EVENT);
var POINT_CATEGORY = {
  SPORTS: "SPORTS"
};
var pointEntryRef = {
  opening: (walletId) => `open:${walletId}`,
  baseline: (walletId) => `baseline:${walletId}`,
  bet: (betType, betId) => `settle:bet:${betType}:${betId}`,
  // settlement ke baad void: original settle:bet:* entry kabhi delete nahi hoti,
  // uske saamne ye ulti entry banti hai (POINT_EVENT.REVERSAL)
  betReversal: (betType, betId) => `reverse:bet:${betType}:${betId}`,
  // win commission on a settled bet/market, and its void-time reversal
  commission: (betType, betId) => `commission:bet:${betType}:${betId}`,
  commissionReversal: (betType, betId) => `reverse:commission:${betType}:${betId}`,
  deposit: (transactionId) => `deposit:${transactionId}`,
  withdraw: (transactionId) => `withdraw:${transactionId}`,
  cashSettle: (transactionId) => `cashsettle:${transactionId}`,
  adjust: (adminUsername, uniqueId) => `adjust:${adminUsername}:${uniqueId}`
};
var LEDGER_CATEGORY_ALIASES = {
  SPORTS: ["SPORTS"]
};

export { POINT_EVENT, POINT_CATEGORY, pointEntryRef, LEDGER_CATEGORY_ALIASES };
