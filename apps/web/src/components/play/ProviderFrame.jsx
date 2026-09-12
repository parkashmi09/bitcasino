import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { useLaunchGame } from '@/queries';
import { useAuth } from '@/auth/AuthProvider';
import { useDisplayCurrency } from '@/hooks/useWallet';

/**
 * An aggregator game's frame, and the two launch calls behind it.
 *
 * `POST /casino/gis/launch` (real money) and `/gis/launch-demo` (fun mode)
 * each answer `201 {url}` for an iframe. Neither is called until the player
 * presses a button: a launch writes a `gis_sessions` row and records the play
 * in recently-played, so doing it on mount would log a play for anyone who
 * opened the page.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE REFUSAL IS THE EXPECTED OUTCOME HERE, AND IT IS NOT AN ERROR STATE.
 *
 * `GIS_MERCHANT_ID` and `GIS_MERCHANT_KEY` are unset on this deployment, so
 * the service answers `503 GIS_NOT_CONFIGURED` before it reaches upstream —
 * it refuses rather than signing a request with `undefined`, because a
 * signature computed against a missing key is stable and guessable.
 *
 * That is a deployment fact, not a fault, and the page says so plainly. It is
 * deliberately worded differently from the 502s (`GIS_UPSTREAM_FAILED`,
 * `GIS_UPSTREAM_REJECTED`), which mean the credentials ARE set and the
 * provider said no — a player can usefully retry one of those and cannot
 * usefully retry the other.
 *
 * Filling the two variables in is what turns this real. Nothing in this file
 * changes.
 * ═════════════════════════════════════════════════════════════════════════
 */

/** Codes that mean "this deployment has no provider", not "it went wrong". */
const NOT_CONFIGURED = new Set(['GIS_NOT_CONFIGURED']);

export function ProviderFrame({ game }) {
  const { status, user } = useAuth();
  const [currency] = useDisplayCurrency();
  const launch = useLaunchGame();
  const [mode, setMode] = useState(null);

  const signedIn = status === 'authenticated';
  const url = launch.data?.url ?? null;

  const open = (next) => {
    setMode(next);
    launch.reset();
    launch.mutate({
      mode: next,
      gameUuid: game.slug,
      // Required by the `.strict()` validator on the real-money route. The
      // player ID is NOT sent — it comes from the token, which is what closed
      // legacy's hole of opening a session against somebody else's balance.
      playerName: user?.name ?? user?.username ?? 'player',
      currency,
    });
  };

  return (
    <>
      <div className="mt-3 grid aspect-video w-full place-items-center overflow-hidden rounded-s-md bg-popo">
        {url ? (
          <iframe
            src={url}
            title={game.title}
            className="size-full border-0"
            allow="fullscreen; autoplay"
            /* The provider's page is not ours and must not reach back into
               this document: no `allow-same-origin` alongside `allow-scripts`,
               which together would let it read this origin's storage — the
               access token included. */
            sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
          />
        ) : launch.isPending ? (
          <p className="text-sm text-goten/60">Opening {mode === 'fun' ? 'fun mode' : game.title}…</p>
        ) : launch.isError ? (
          <LaunchRefused error={launch.error} mode={mode} />
        ) : (
          <div className="text-center">
            <span className="mx-auto grid size-16 place-items-center rounded-full bg-piccolo text-goten">
              <Icon name="play" size={28} className="ms-1" />
            </span>
            <p className="mt-4 font-secondary text-lg font-medium text-goten">{game.title}</p>
            <p className="mt-1 text-xs text-goten/60">Choose fun or real mode to open the game.</p>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="font-secondary text-lg font-medium text-bulma">{game.title}</h1>
          <p className="text-xs text-trunks">{game.provider}</p>
        </div>
        <div className="ms-auto flex gap-2">
          <Button variant="secondary" onClick={() => open('fun')} disabled={launch.isPending}>
            Fun mode
          </Button>
          {signedIn ? (
            <Button onClick={() => open('real')} disabled={launch.isPending}>
              Real mode
            </Button>
          ) : (
            /* Real mode needs a wallet. Sending a signed-out visitor to a 401
               and rendering it as a launch failure would blame the game for
               the session. */
            <Button as={Link} to="/login">
              Log in to play
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * Why the frame is empty, in the player's terms.
 *
 * Three different sentences, because three different people can act on them:
 * an operator sets the credentials, a player retries a provider blip, and
 * nobody can do anything about a locked account except contact support.
 */
function LaunchRefused({ error, mode }) {
  const code = error?.code ?? 'UNKNOWN_ERROR';

  const message = NOT_CONFIGURED.has(code)
    ? 'This game is served by an aggregator, and no provider credentials are set on this deployment. Nothing is wrong with the game — there is no upstream to open it against.'
    : code === 'GIS_CASINO_LOCKED'
      ? 'Casino play is locked on this account. Support can tell you why.'
      : code === 'GIS_UNSUPPORTED_CURRENCY'
        ? 'That currency cannot be used for this game. Switch the wallet to USDT or INR and try again.'
        : error?.message || 'The game could not be opened.';

  return (
    <div className="max-w-[420px] px-6 text-center">
      <span className="mx-auto grid size-14 place-items-center rounded-full bg-goten/10 text-goten">
        <Icon name="warning" size={24} />
      </span>
      <p className="mt-3 text-sm font-medium text-goten">
        {NOT_CONFIGURED.has(code)
          ? 'Provider not configured'
          : `${mode === 'fun' ? 'Fun mode' : 'Real mode'} could not start`}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-goten/60">{message}</p>
      {/* The code, because it is what a support ticket or a deployment check
          is actually about. */}
      <p className="mt-3 font-mono text-[10px] text-goten/40">{code}</p>
    </div>
  );
}
