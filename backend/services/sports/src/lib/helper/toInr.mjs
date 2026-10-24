// helper/toInr.mjs — a stake in any coin, in INR (user, 2026-10-17): the exchange runs on INR,
// so placeBet converts once at the platform's own rate table (public.exchangerate,
// usd_rate = USD per unit) and everything after it stays as it was.
import { db_default, init_db } from "../config/db.mjs";
import { QueryTypes } from "sequelize";

init_db();

// The rate table may carry no row for these; they are the dollar itself.
var ONE_USD = ["USD", "USDT"];

/** USD per unit of `code` and of INR, or an error when either has no rate. */
var ratesOf = async (code) => {
  const rows = await db_default.query(
    "SELECT UPPER(currency) AS currency, usd_rate FROM public.exchangerate WHERE UPPER(currency) IN (:codes)",
    { replacements: { codes: [code, "INR"] }, type: QueryTypes.SELECT }
  );
  const rate = (c) => Number(rows.find((r) => r.currency === c)?.usd_rate) || (ONE_USD.includes(c) ? 1 : 0);
  const coin = rate(code);
  const inr = rate("INR");
  if (!(coin > 0) || !(inr > 0)) throw new Error(`No exchange rate for ${code}`);
  return { coin, inr };
};

var toInr = async (amount, currency) => {
  const code = String(currency || "").trim().toUpperCase();
  const n = Number(amount);
  if (code === "INR") return n;
  const { coin, inr } = await ratesOf(code);
  return Math.round(n * coin / inr * 100) / 100;
};

// The other way: an INR figure (a point-ledger delta, sign kept) in the bet's coin. Not rounded
// to 2 places — a coin like BTC needs its decimals (8, the ledger column's scale).
var inrToCurrency = async (amount, currency) => {
  const code = String(currency || "INR").trim().toUpperCase();
  const n = Number(amount);
  if (code === "INR") return n;
  const { coin, inr } = await ratesOf(code);
  return Math.round(n * inr / coin * 1e8) / 1e8;
};

// A bet's usd_amount (VIP wager, commission, admin reports): INR at the admin's usd_rate.
// 0.012 only when the table has no INR row, so a bet is never refused over it.
var INR_USD_FALLBACK = 0.012;
var inrToUsd = async (inrAmount = 0) => {
  const n = Number(inrAmount) || 0;
  const usd = await inrToCurrency(n, "USD").catch(() => n * INR_USD_FALLBACK);
  return Math.round(usd * 100) / 100;
};

export { toInr, inrToCurrency, inrToUsd };
