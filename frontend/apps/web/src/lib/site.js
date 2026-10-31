/**
 * The brand this deployment shows. A white-label build sets its own at build
 * time; nothing here names a real operator, licence holder or mailbox.
 *
 * `SUPPORT_EMAIL` is empty unless the deployment sets one, and every "Email us"
 * card hides itself then — a mailto to someone else's inbox is worse than none.
 */
export const SITE_NAME = import.meta.env.VITE_SITE_NAME || 'TestPlay';
export const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || '';

/** Who runs the site, in words that fit any deployment; `VITE_OPERATOR_NOTICE` replaces it. */
export const OPERATOR_NOTICE =
  import.meta.env.VITE_OPERATOR_NOTICE ||
  `${SITE_NAME} is run by its own independent operator. The operator's company and licence details are available from customer support on request.`;
