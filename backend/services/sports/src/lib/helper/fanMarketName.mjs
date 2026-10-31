// helper/fanMarketName.js — mssports core, moved unchanged

var isKhadoBet = (bet) => String(bet?.market_type || "").toLowerCase() === "khado";
var fanMarketName = (bet) => isKhadoBet(bet) ? bet?.selection_name || bet?.fancy_name || null : bet?.fancy_name || bet?.selection_name || null;

export { isKhadoBet, fanMarketName };
