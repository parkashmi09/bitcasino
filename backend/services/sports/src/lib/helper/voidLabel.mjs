// helper/voidLabel.js — mssports core, moved unchanged
import { POINT_EVENT } from "../constants/pointLedger.mjs";

var VOID_SUFFIX = "-void";
var isVoidRow = (row) => row?.event_type === POINT_EVENT.REVERSAL || String(row?.entry_ref || "").startsWith("reverse:");
var stripVoidPrefix = (text) => String(text || "").replace(/^VOID after settlement\s*[—-]\s*/i, "").trim();
var withVoidSuffix = (text) => {
  const s = stripVoidPrefix(text);
  if (!s) return VOID_SUFFIX;
  return s.endsWith(VOID_SUFFIX) ? s : `${s} ${VOID_SUFFIX}`;
};

export { isVoidRow, stripVoidPrefix, withVoidSuffix };
