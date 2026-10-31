// helper/cricketFormat.js — mssports core, moved unchanged

var TEST_FORMAT_RE = /\btest\b|ashes|first[\s-]?class|county\s+champ|sheffield\s+shield|ranji|plunket/i;
var isCricketTestFormat = (text) => TEST_FORMAT_RE.test(String(text || ""));

export { isCricketTestFormat };
