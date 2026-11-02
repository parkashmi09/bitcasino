// Builds src/i18n/<code>.json for every string in scripts/i18n-strings.json:
// node scripts/i18n-merge.mjs <dir of new translations> [<dir of a base dictionary, e.g. rainbet's src/i18n>]
// A key present in the new file wins; then the base; strings in neither stay English (left out).
import fs from 'fs';
import path from 'path';
const [fresh, base] = process.argv.slice(2);
const keys = JSON.parse(fs.readFileSync('scripts/i18n-strings.json', 'utf8'));
for (const code of ['ar', 'es', 'fr', 'ja', 'pt', 'ru', 'tr', 'zh']) {
  const read = (dir) => (dir && fs.existsSync(path.join(dir, `${code}.json`)) ? JSON.parse(fs.readFileSync(path.join(dir, `${code}.json`), 'utf8')) : {});
  const a = read(fresh), b = read(base);
  const out = {};
  for (const k of keys) {
    const v = a[k] ?? b[k];
    if (typeof v === 'string' && v.trim() && v !== k) out[k] = v;
  }
  fs.writeFileSync(`src/i18n/${code}.json`, `${JSON.stringify(out, null, 0).replace(/","/g, '",\n"')}\n`);
  console.log(code, Object.keys(out).length, '/', keys.length);
}
