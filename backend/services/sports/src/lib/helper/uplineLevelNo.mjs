// helper/uplineLevelNo.js — mssports core, moved unchanged

var OWNER_UPLINE_NO = 7;
var uplineNo = (level) => {
  const l = parseInt(String(level || "").replace(/\D/g, ""), 10);
  return Number.isNaN(l) ? OWNER_UPLINE_NO : 1 + (6 - l);
};

export { OWNER_UPLINE_NO, uplineNo };
