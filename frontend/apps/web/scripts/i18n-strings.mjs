// Lists the player site's English UI strings: `node scripts/i18n-strings.mjs` (from apps/web/).
// Writes scripts/i18n-strings.json; each src/i18n/<code>.json has these as its keys.
// Legal and SEO prose is left out on purpose: those pages stay in English.
import fs from "fs";
import path from "path";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default ?? traverseModule;
const SKIP_DIRS = new Set(["data", "i18n"]);
const SKIP_FILES = /(.test.|currencies.js|TermsAndConditions|PrivacyPolicy|AmlPolicy|DisputeResolution|OurLicense|ResponsibleGaming|SelfExclusion|ProvablyFair|RewardTerms|BitcoinBreakdown|Help[A-Z]w*|SeoContent|TrustSection|CashierFAQ|CryptoFeatures)/;
const ATTRS = new Set(["placeholder", "title", "aria-label", "label"]);
const PROPS = new Set(["label", "title", "placeholder", "description", "desc", "heading", "subtitle", "text", "message", "cta", "tooltip", "hint"]);
const SKIP_PROPS = new Set(["id", "key", "href", "src", "img", "image", "icon", "art", "className", "code", "slug", "currency", "symbol", "name", "provider", "game", "alt", "type", "value", "uid", "uuid"]);
const CALLS = /^(toast|alert|notify|showToast|setError|setMessage|setNotice)$/;

const strings = new Set();
const add = (raw) => {
  const s = String(raw).replace(/\s+/g, " ").trim();
  if (s.length < 2 || s.length > 220 || !/\p{Ll}{2}/u.test(s)) return;
  if (/^(\/|https?:|#|\.|rb:|Rb[A-Z])/.test(s)) return;
  // A lower-case word with no space is a key or class name, not text.
  if (/^[a-z0-9_.:-]+$/.test(s) || /^\S*_\S*( \S*_\S*)*$/.test(s)) return;
  strings.add(s);
};

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    if (fs.statSync(file).isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(file);
    } else if (/\.jsx?$/.test(name) && !SKIP_FILES.test(name)) {
      const ast = parse(fs.readFileSync(file, "utf8"), { sourceType: "module", plugins: ["jsx"], errorRecovery: true });
      traverse(ast, {
        JSXText: (p) => add(p.node.value),
        JSXAttribute(p) {
          if (ATTRS.has(p.node.name.name) && p.node.value?.type === "StringLiteral") add(p.node.value.value);
        },
        JSXExpressionContainer(p) {
          if (p.parent.type === "JSXElement" && p.node.expression.type === "StringLiteral") add(p.node.expression.value);
        },
        ObjectProperty(p) {
          const key = p.node.key.name ?? p.node.key.value;
          if (PROPS.has(key) && p.node.value.type === "StringLiteral") add(p.node.value.value);
        },
        // Any other literal that reads as text: tab("overview", "Overview"), arrays, ternaries.
        StringLiteral(p) {
          const up = p.parent.type;
          if (up === "ImportDeclaration" || up === "ExportNamedDeclaration" || up === "ExportAllDeclaration" || up === "JSXAttribute") return;
          if (up === "ObjectProperty" && p.key === "key") return;
          if (up === "ObjectProperty" && SKIP_PROPS.has(p.parent.key.name ?? p.parent.key.value)) return;
          if (up === "BinaryExpression") return;
          if (/^\p{Lu}/u.test(p.node.value) && !/[{}<>=;\\]|\.(svg|png|webp|jpe?g|css|js)\b/.test(p.node.value)) add(p.node.value);
        },
        CallExpression(p) {
          const callee = p.node.callee;
          const fn = callee.name ?? callee.property?.name ?? "";
          if (CALLS.test(fn) && p.node.arguments[0]?.type === "StringLiteral") add(p.node.arguments[0].value);
        },
      });
    }
  }
}

walk("src");
fs.writeFileSync("scripts/i18n-strings.json", `${JSON.stringify([...strings].sort(), null, 0).replace(/","/g, '",\n"')}\n`);
console.log(strings.size, "strings,", [...strings].join("").length, "chars");
