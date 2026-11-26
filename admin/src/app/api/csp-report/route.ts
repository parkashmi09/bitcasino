/**
 * Collects Content-Security-Policy-Report-Only reports (next.config.ts). Each distinct
 * directive + blocked origin is logged once per server process, so the log becomes the list of
 * origins the enforced policy must allow. Nothing is stored. Remove when the policy is enforced.
 */
const seen = new Set();
const MAX = 500;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const r: Record<string, unknown> = body?.['csp-report'] ?? body?.[0]?.body ?? body ?? {};
    const directive = String(r['effective-directive'] ?? r.effectiveDirective ?? r['violated-directive'] ?? '').slice(0, 60);
    let blocked = String(r['blocked-uri'] ?? r.blockedURL ?? '');
    try { blocked = new URL(blocked).origin; } catch { blocked = blocked.slice(0, 40); }
    const key = `${directive} ${blocked}`;
    if (seen.size < MAX && !seen.has(key)) {
      seen.add(key);
      console.warn(`[csp-report] ${key}`);
    }
  } catch {
    /* a malformed report is ignored */
  }
  return new Response(null, { status: 204 });
}
