import { setLanguage, useAllowedLanguages, useLanguage } from '@/lib/i18n';

/**
 * A native `<select>` over the languages the owner allows (`lib/i18n.js`). Nothing renders with
 * fewer than two. The language names are never translated (`notranslate`).
 * `overlay`: an invisible select stretched over its parent, for a row that draws its own label.
 */
export function LanguageSelect({ id, className, overlay = false, label = 'Language' }) {
  const allowed = useAllowedLanguages();
  const lang = useLanguage();
  if (allowed.length < 2) return null;
  return (
    <select
      id={id}
      aria-label={label}
      value={lang}
      onChange={(event) => setLanguage(event.target.value)}
      className={overlay ? 'notranslate absolute inset-0 cursor-pointer opacity-0' : `notranslate ${className ?? ''}`}
    >
      {allowed.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  );
}
