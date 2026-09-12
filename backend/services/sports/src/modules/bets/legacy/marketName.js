'use strict';

/**
 * `placedata` — the market name the legacy handler derived before placing.
 *
 * Copied VERBATIM out of `legacy/sportsmain/API/service.js:296-350`. In the
 * live handler its result feeds a `console.log` and nothing else: the block
 * that used it (the post-market call to turnkeyxgaming, and the
 * `match_title = placedata.marketName` reassignment for match/bookmaker) is
 * commented out in legacy — controller.js:267-317. It is carried across so the
 * port has no gaps, and it is as inert here as it is there.
 *
 * @legacy legacy/sportsmain/API/service.js:296-350
 */
const getMarketNameFromGtype = ({ mname, gtype, nat, section }) => {


    // legacy `console.log("market name from gtype", ...)` — dropped. It ran on
    // every bet, and this service logs through pino.
    if (!mname || !gtype) return null;

    /* =======================
       1️⃣ MATCH / MATCH1
       section se "vs" banta hai
    ======================= */
    if (gtype === "match" || gtype === "match1") {
        let sections = [];

        if (Array.isArray(section)) {
            sections = section;
        } else if (typeof section === "string") {
            try {
                sections = JSON.parse(section);
            } catch (e) {
                sections = [];
            }
        }


        const runnerNames = sections
            .map((s) => s?.nat?.trim())
            .filter(Boolean);

        if (runnerNames.length === 0) return null;

        const marketName =
            runnerNames.length > 1
                ? runnerNames.join(" vs ")
                : runnerNames[0];

        return {
            mname,
            gtype,
            marketName,
        };
    }

    /* =======================
       2️⃣ ALL OTHER TYPES
       nat is single string
       section ignored
    ======================= */
    if (!nat || typeof nat !== "string") return null;

    return {
        mname,
        gtype,
        marketName: nat.trim(),
    };
};
module.exports = { getMarketNameFromGtype };
