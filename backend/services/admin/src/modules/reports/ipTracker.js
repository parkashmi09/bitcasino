'use strict';

/**
 * Whether an address is loopback, private or link-local.
 *
 * These never geolocate (a dev box logs everyone in from 127.0.0.1, and an
 * office NAT puts every player behind 10.x), so the tracker marks them rather
 * than reporting a "shared IP" that only means "same network as the server".
 */
function isPrivateIp(ip) {
  if (!ip) return false;
  const value = String(ip).trim().toLowerCase().replace(/^::ffff:/, '');
  if (value === '::1' || value === 'localhost') return true;
  if (/^(fc|fd)[0-9a-f]{2}:/.test(value) || value.startsWith('fe80:')) return true;

  const octets = value.split('.').map(Number);
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n))) return false;
  const [a, b] = octets;
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    a === 0
  );
}

/**
 * A user-agent as "Browser on OS" for the risk view's login list. Order
 * matters: Edge and Opera also say Chrome, Chrome also says Safari, and
 * Android also says Linux.
 */
function deviceFromUA(ua) {
  if (!ua) return null;
  const os =
    /Windows/i.test(ua) ? 'Windows'
      : /Android/i.test(ua) ? 'Android'
        : /iPhone|iPad|iPod|iOS/i.test(ua) ? 'iOS'
          : /Mac OS|Macintosh/i.test(ua) ? 'macOS'
            : /Linux/i.test(ua) ? 'Linux' : null;
  const browser =
    /Edg\//i.test(ua) ? 'Edge'
      : /OPR\/|Opera/i.test(ua) ? 'Opera'
        : /Firefox\//i.test(ua) ? 'Firefox'
          : /Chrome\/|CriOS\//i.test(ua) ? 'Chrome'
            : /Safari\//i.test(ua) ? 'Safari' : null;
  if (!os && !browser) return 'Other';
  return `${browser ?? 'Browser'} on ${os ?? 'unknown OS'}`;
}

module.exports = { isPrivateIp, deviceFromUA };
