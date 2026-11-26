/* Full-colour sport icons (public/images/sports-color, from hash-game-exchange; chess and wrestling
 * are Microsoft Fluent Emoji 3D, MIT), keyed by the same icon key as SportIcon (pages/Exchange/model.js sportIconOf). */
const KEYS = [
  'americanfootball', 'badminton', 'baseball', 'basketball', 'blitz-basketball', 'boxing', 'chess',
  'cricket', 'darts', 'formula-1', 'golf', 'greyhound', 'handball', 'horseracing', 'icehockey', 'mma',
  'rugby', 'snooker', 'soccer', 'tabletennis', 'tennis', 'volleyball', 'wrestling',
];

export const SPORT_COLOR_ART = Object.fromEntries(KEYS.map((key) => [key, `/images/sports-color/${key}.png`]));
