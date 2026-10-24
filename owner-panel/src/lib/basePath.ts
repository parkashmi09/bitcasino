/** The panel's mount point (`BASEPATH` at build time, e.g. `/owner`); empty when served at the root. */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

/** A same-origin path with the mount point in front, for `fetch` and `location`. Next's Link/router add it themselves. */
export const withBase = (path: string) => `${BASE_PATH}${path}`
