// utils/jwt.js — mssports core, moved; verifies the platform's tokens (lib/identity/platformAccounts.mjs).

import { decodePlatformToken } from "../identity/platformAccounts.mjs";
function verifyToken(token) {
  return decodePlatformToken(token);
}

export { verifyToken };
