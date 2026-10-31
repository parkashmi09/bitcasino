// sportsMain/config/env.js — mssports odds worker, moved unchanged

var env_default = {
  SPORTS_BASE_URL: "http://primarydiamondfeeds.turnkeyxgaming.com:8000",
  SPORTS_API_KEY: process.env.SPORTS_API_KEY
  // was hardcoded in tenexch; moved to .env for the export
};

export { env_default };
