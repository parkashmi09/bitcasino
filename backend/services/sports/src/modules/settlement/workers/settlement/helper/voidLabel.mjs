// helper/voidLabel.js — mssports settlement worker, moved unchanged

var VOID_SUFFIX = "-void";
var stripVoidPrefix = (text) => String(text || "").replace(/^VOID after settlement\s*[—-]\s*/i, "").trim();
var withVoidSuffix = (text) => {
  const s = stripVoidPrefix(text);
  if (!s) return VOID_SUFFIX;
  return s.endsWith(VOID_SUFFIX) ? s : `${s} ${VOID_SUFFIX}`;
};

export { withVoidSuffix };
