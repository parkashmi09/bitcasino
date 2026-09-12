'use strict';

/**
 * Email bodies.
 *
 * ── EVERY VALUE IS ESCAPED ───────────────────────────────────────────────
 * The legacy templates interpolated straight into HTML:
 *
 *     <div class="otp-code">${data.otp}</div>
 *     <p>${data.message}</p>
 *
 * and `/email/send` took `title` and `content` from an unauthenticated request
 * body, so the caller wrote the markup. The route is staff-only now, but a
 * template that trusts its inputs is still a template that will be handed
 * something untrusted eventually — a player's display name, a support ticket
 * subject — so escaping happens here rather than at each call site.
 *
 * `content` is the one deliberate exception: an operator broadcast is composed
 * as rich text and the route that supplies it requires a staff token. That is
 * stated at its parameter rather than left for a reader to infer.
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Only http(s) links survive. `javascript:` in an email is a real click. */
function safeUrl(url) {
  const value = String(url ?? '').trim();
  return /^https?:\/\/[^\s"'<>]+$/i.test(value) ? value : null;
}

const SHELL = ({ heading, body, footer }) => `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background:#f8f9fa;">
    <div style="max-width:600px;margin:0 auto;">
      <div style="background:linear-gradient(135deg,#6366F1 0%,#4F46E5 100%);padding:30px;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:24px;">${escape(heading)}</h1>
      </div>
      <div style="padding:40px 20px;background:#fff;border-radius:8px;margin:20px;">
        ${body}
      </div>
      <div style="text-align:center;padding:20px;color:#64748b;font-size:12px;">
        ${footer}
      </div>
    </div>
  </body>
</html>`;

const PURPOSE_COPY = {
  register: { heading: 'Confirm your email', message: 'Use this code to finish creating your account.' },
  login: { heading: 'Sign-in code', message: 'Use this code to sign in.' },
  'reset-password': { heading: 'Reset your password', message: 'Use this code to set a new password.' },
  'reset-2fa': {
    heading: 'Reset two-factor authentication',
    message: 'Use this code to turn off two-factor authentication on your account.',
  },
};

/**
 * A one-time code.
 *
 * The validity is passed in rather than written into the copy. The legacy
 * template said "Valid for 2 minutes only" as static text, so changing the TTL
 * would have left the email contradicting the system.
 */
function renderOtp({ code, purpose, ttlSeconds }) {
  const copy = PURPOSE_COPY[purpose] ?? { heading: 'Verification code', message: 'Use this code to continue.' };
  const minutes = Math.max(1, Math.round(ttlSeconds / 60));

  return {
    subject: copy.heading,
    text: `${copy.message}\n\nYour code is ${code}. It is valid for ${minutes} minute${minutes === 1 ? '' : 's'}.\n\nIf you did not request this, ignore this email.`,
    html: SHELL({
      heading: copy.heading,
      body: `
        <p>Hello,</p>
        <p>${escape(copy.message)}</p>
        <div style="background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;padding:20px;text-align:center;margin:20px 0;">
          <div style="font-size:32px;letter-spacing:8px;color:#4F46E5;font-weight:bold;">${escape(code)}</div>
          <div style="color:#ef4444;font-size:14px;margin-top:10px;">Valid for ${minutes} minute${minutes === 1 ? '' : 's'}</div>
        </div>
        <p>If you didn't request this code, please ignore this email. Nobody can use it without your inbox.</p>`,
      // No timestamp. The legacy footer rendered `new Date().toLocaleString()`
      // in the SERVER's locale and timezone, which told every recipient where
      // the server is and nothing useful about when they received it.
      footer: `<p>&copy; ${new Date().getFullYear()} All rights reserved.</p>`,
    }),
  };
}

/**
 * An operator message.
 *
 * `content` is inserted as HTML — this is the composed body of a staff-authored
 * broadcast, and the route that accepts it requires a staff token. Everything
 * else is escaped.
 */
function renderGeneral({ subject, title, content, ctaLink, ctaText }) {
  const link = safeUrl(ctaLink);

  const cta = link
    ? `<p style="text-align:center;margin:30px 0;">
         <a href="${escape(link)}" style="background:#4F46E5;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;display:inline-block;">
           ${escape(ctaText || 'Open')}
         </a>
       </p>`
    : '';

  return {
    subject: String(subject ?? '').slice(0, 200),
    text: String(content ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    html: SHELL({
      heading: title || subject,
      body: `${content ?? ''}${cta}`,
      footer: `<p>&copy; ${new Date().getFullYear()} All rights reserved.</p>`,
    }),
  };
}

module.exports = { renderOtp, renderGeneral, escape, safeUrl };
