// helper/tokenBlacklist.js — mssports core, moved unchanged
import { TokenBlacklist_default } from "../../models/admin/TokenBlacklist.mjs";

import crypto from "crypto";
import { Op as Op3 } from "sequelize";
var hash = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");
var isTokenBlacklisted = async (token) => {
  const row = await TokenBlacklist_default.findOne({
    where: { token: { [Op3.in]: [hash(token), token] } }
  });
  return !!row;
};

export { isTokenBlacklisted };
