const hexRgb = (hex) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (rgb, to, t) => rgb.map((c, i) => Math.round(c + (to[i] - c) * t)).join(' ');
const CUSTOM_VARS = ['--piccolo', '--piccolo-80', '--piccolo-120', '--jiren', '--on-piccolo', '--goku', '--goku-40', '--goku-80', '--gohan', '--beerus', '--hit', '--bulma', '--trunks'];

/**
 * An owner-made theme (`{accent, onAccent, bg, card, border, input, fg, muted, …}`, 6-digit hex)
 * onto the Moon tokens, inline on <html>, the same way tokens.css maps the built-in templates.
 * Returns the cleanup that drops it again.
 */
export function applyCustomPalette(colours) {
  const html = document.documentElement;
  const hex = (key) => (/^[0-9a-f]{6}$/i.test(colours?.[key] ?? '') ? hexRgb(colours[key]) : null);
  if (!hex('accent')) return undefined;
  const accent = hex('accent');
  const set = {
    '--piccolo': accent.join(' '),
    '--piccolo-80': mix(accent, [255, 255, 255], 0.2),
    '--piccolo-120': mix(accent, [0, 0, 0], 0.15),
    '--jiren': `${accent.join(' ')} / 0.12`,
  };
  const optional = { '--on-piccolo': 'onAccent', '--goku': 'bg', '--goku-40': 'card', '--goku-80': 'card', '--gohan': 'card', '--beerus': 'border', '--hit': 'input', '--bulma': 'fg', '--trunks': 'muted' };
  for (const [name, key] of Object.entries(optional)) if (hex(key)) set[name] = hex(key).join(' ');
  for (const [name, v] of Object.entries(set)) html.style.setProperty(name, v);
  return () => CUSTOM_VARS.forEach((name) => html.style.removeProperty(name));
}
