/**
 * Is this coin switched off for the site? Off when its own Site flag is off, or — a crypto coin —
 * when the crypto master switch (`cryptocoin`) is off. The default coin and the reward coin must
 * never be such a coin: every money screen and every promotion would be valued in a currency
 * players can't hold.
 */
export const coinSwitchedOff = (coin: string, flags: Record<string, boolean>, fiatFlags: ReadonlySet<string>) =>
  flags[coin] === false || (!fiatFlags.has(coin) && flags.cryptocoin === false)
