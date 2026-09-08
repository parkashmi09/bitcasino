/**
 * The player's notification feed.
 *
 * STATIC, like `catalog.js` and `loyalty.js`, and for the same reason: the
 * platform in `backend/` has no notification service. There is no feed route in
 * user-service, and the nearest things — `club-broadcasts`, the `social` socket
 * — are neither of them this.
 *
 * This is the seam. When a feed endpoint lands, add it to `lib/endpoints.js`,
 * read it in `useNotifications`, and delete this file. Rows take the shape
 * below either way:
 *
 *   id     stable key, and what the read set in `useNotifications` stores
 *   body   one line of plain text; the reference does not mark any of it up
 *   at     ISO date. Rendered as `WEDNESDAY, SEPTEMBER 3, 2026` — the reference
 *          uppercases a long-form date in CSS, so the string stays readable
 *
 * Newest first: the page renders them in array order and does not sort.
 */
export const NOTIFICATIONS = [
  {
    id: 'welcome',
    body: 'Great to see you on the site. Check out the offers we have specially for you by clicking here!',
    at: '2026-09-07',
  },
  {
    id: 'weekly-drop',
    body: 'Your weekly bonus drop is ready to claim. It expires in 72 hours.',
    at: '2026-09-03',
  },
  {
    id: 'tournament-result',
    body: 'The Midweek Reload tournament has finished. You placed 41st out of 2,180 players.',
    at: '2026-08-28',
  },
];
