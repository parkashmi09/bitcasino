/**
 * Probe the platform before a single spec runs.
 *
 * Without this, a closed gateway produces twelve specs each timing out on its
 * own assertion — a wall of red that says "the balance chip never appeared"
 * when what actually happened is that nothing was listening on :4000. The
 * first line of a CI log should say which of those it is.
 *
 * It is also the guard against the failure mode this repository has written
 * about elsewhere: a check that passes without having run. There is no
 * `skip if absent` here. If the platform is not up, the suite FAILS, loudly,
 * with the commands to bring it up — because an end-to-end suite that quietly
 * skipped would be a green tick over an untested seam.
 */

const GATEWAY = process.env.E2E_GATEWAY || 'http://127.0.0.1:4000';

/**
 * A public route with no side effects, no auth and no seeded data required.
 *
 * `GET /casino/games/stats` answers `{gameTypes, topProviders}` for an empty
 * catalogue just as happily as a full one, so this proves the gateway is up
 * and routing to casino-service without also asserting the seed ran — which
 * is a different failure with a different fix, and is checked below.
 */
const PROBE = `${GATEWAY}/api/v1/casino/games/stats`;

const HOW = `
  cd backend && npm run db:migrate && npm run db:seed:demo
  cd backend && npm run dev:test user admin casino gateway
  cd apps/web && npm run test:e2e
`;

export default async function globalSetup() {
  let response;

  try {
    response = await fetch(PROBE, { signal: AbortSignal.timeout(5_000) });
  } catch (error) {
    throw new Error(
      `The platform is not reachable at ${GATEWAY} (${error.message}).\n` +
        `These tests drive a real browser against the real backend and cannot run without it.\n${HOW}`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `${PROBE} answered ${response.status}.\n` +
        `The gateway is up but not routing to casino-service — start it with the others.\n${HOW}`,
    );
  }

  const body = await response.json().catch(() => null);

  /**
   * The envelope, not just the status.
   *
   * A reverse proxy or a captive portal will happily answer 200 with HTML at
   * this URL. `{success: true, data}` is what says we are talking to the
   * platform rather than to something in front of it.
   */
  if (body?.success !== true) {
    throw new Error(
      `${PROBE} answered 200 but not the platform's envelope.\n` +
        `Something else is listening on ${GATEWAY}.\n${HOW}`,
    );
  }

  /**
   * And the catalogue, separately, because an empty one fails these specs in
   * a way that reads as a broken app.
   *
   * `topProviders` is empty on a migrated-but-unseeded database. The home
   * page then renders its empty states correctly and the spec that opens a
   * game finds no game to open — which is a seed problem wearing a UI
   * problem's clothes.
   */
  const providers = body?.data?.topProviders ?? [];
  if (!Array.isArray(providers) || providers.length === 0) {
    throw new Error(
      `The platform is up but the catalogue is EMPTY — no providers in games/stats.\n` +
        `Seed it, or these specs will fail on a game that does not exist:\n${HOW}`,
    );
  }

  console.log(
    `e2e: platform up at ${GATEWAY}, ${providers.length} provider(s) in the catalogue`,
  );
}
