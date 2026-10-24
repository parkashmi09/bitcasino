// services/settlement/sportsCommissionService.js — mssports core, moved unchanged
import { init_db } from "../../../lib/config/db.mjs";

init_db();
var COMMISSION_REASON = "commission";
var COMMISSION_VOID_REASON = "commission_void";

export { COMMISSION_REASON, COMMISSION_VOID_REASON };
