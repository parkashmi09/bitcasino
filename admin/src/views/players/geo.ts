/** A two-letter country code as its flag emoji; '' for anything else. */
export const countryFlag = (cc?: string | null) =>
  cc && /^[A-Z]{2}$/i.test(cc) ? String.fromCodePoint(...[...cc.toUpperCase()].map(c => 0x1f1a5 + c.charCodeAt(0))) : ''
