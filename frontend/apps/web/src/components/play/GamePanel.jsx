import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { isPlayable, useLaunchGame } from '@/queries';
import { useAuth } from '@/auth/AuthProvider';
import { useDisplayCurrency } from '@/hooks/useWallet';
import { cn } from '@/lib/cn';
import { LimboGame } from './LimboGame';
import { SignInToPlay } from './SignInToPlay';
import { LikeButton, FavouriteButton } from './GameActions';
import { GameStatsPopover, GameStatsAccordion } from './GameStats';
import { GameInfo } from './GameInfo';

/**
 * The reference's `p-3 bg-secondary rounded-lg` card: everything under a game.
 *
 * One card, four rows — game area, toolbar, the mobile stats accordion, the
 * desktop info copy — and the toolbar and info rows are what hide as the shell
 * expands and fullscreens, via the named `group/shell` on the page's columns.
 *
 * The card also owns the frame's launch state, which lives here rather than in
 * `Play` because the toolbar's Fun/Real switch and the area it opens are two
 * halves of one decision: choosing a mode is what mounts the iframe.
 */

/** Codes that mean "this deployment has no provider", not "it went wrong". */
const NOT_CONFIGURED = new Set(['GIS_NOT_CONFIGURED']);

export function GamePanel({ game, view, onExpand, onFullscreen }) {
  const { status, user } = useAuth();
  const [currency] = useDisplayCurrency();
  const navigate = useNavigate();
  const launch = useLaunchGame();
  const [mode, setMode] = useState(null);

  const signedIn = status === 'authenticated';
  const playable = isPlayable(game);
  const fullscreen = view === 'fullscreen';
  const url = launch.data?.url ?? null;

  /** Launch a mode — `POST /casino/gis/launch` (real) or `/launch-demo` (fun).
   *  Neither is called on mount: a launch writes a `gis_sessions` row and logs
   *  the play, so doing it on page load would record a round nobody played. */
  const open = (next) => {
    if (next === 'real' && !signedIn) {
      navigate('/login');
      return;
    }
    setMode(next);
    launch.reset();
    launch.mutate({
      mode: next,
      gameUuid: game.slug,
      // Required by the `.strict()` validator on the real-money route. The
      // player ID is NOT sent — it comes from the token.
      playerName: user?.name ?? user?.username ?? 'player',
      currency,
    });
  };

  return (
    <div>
      {playable ? (
        signedIn ? (
          <LimboGame game={game} />
        ) : (
          <SignInToPlay title={game.title} />
        )
      ) : game.inHouse ? (
        <NotBuilt game={game} />
      ) : (
        <FrameBox>
          {url ? (
            <iframe
              src={url}
              title={game.title}
              className="size-full border-0"
              allow="fullscreen; autoplay"
              /* The provider's page is not ours and must not reach back into
                 this document: no `allow-same-origin` alongside
                 `allow-scripts`, which together would let it read this
                 origin's storage — the access token included. */
              sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
            />
          ) : launch.isPending ? (
            <p className="text-sm text-trunks">
              Opening {mode === 'fun' ? 'fun mode' : game.title}…
            </p>
          ) : launch.isError ? (
            <LaunchRefused error={launch.error} mode={mode} />
          ) : (
            <ChooseMode game={game} />
          )}
        </FrameBox>
      )}

      {/*
        The toolbar. `group-data-[view=...]/shell` hides it when the shell is
        expanded or fullscreened — the reference hides the same rows; the game
        is the whole point in those views.
      */}
      <div
        className={cn(
          'mt-3 flex items-center justify-between gap-4',
          'group-data-[view=expanded]/shell:hidden group-data-[view=fullscreen]/shell:hidden',
        )}
      >
        {!game.inHouse ? (
          <ModeSwitch mode={mode} pending={launch.isPending} onChoose={open} />
        ) : (
          /* An in-house original has no aggregator mode to switch — Fun/Real
             is a property of a provider launch. The row still needs its left
             slot so the action cluster can sit at the end of it. */
          <span />
        )}

        <div className={cn('flex items-center gap-1 md:gap-2', game.inHouse && 'ms-auto')}>
          <LikeButton game={game} />
          <GameStatsPopover game={game} />
          <span aria-hidden className="mx-1 h-4 w-px bg-trunks/30" />
          <FavouriteButton game={game} />
          <ToolbarButton
            label="Expand the game"
            data-testid="expand-button"
            onClick={() => onExpand(view === 'expanded' ? 'min' : 'expanded')}
          >
            <Icon name={view === 'expanded' ? 'shrink' : 'expand'} size={18} />
          </ToolbarButton>
          <ToolbarButton
            label={fullscreen ? 'Leave fullscreen' : 'Fullscreen'}
            data-testid="fullscreen-button"
            onClick={() => onFullscreen(!fullscreen)}
          >
            <Icon name={fullscreen ? 'shrink' : 'maximize'} size={18} />
          </ToolbarButton>
        </div>
      </div>

      <GameStatsAccordion
        game={game}
        className="group-data-[view=expanded]/shell:hidden group-data-[view=fullscreen]/shell:hidden"
      />

      {/*
        The desktop info copy — title, badges, description and the SEO block.
        Its mobile twin lives in the page's aside (`md:hidden`), which is what
        the reference does.
      */}
      <div
        className={cn(
          'mt-6 hidden md:block',
          'group-data-[view=expanded]/shell:hidden group-data-[view=fullscreen]/shell:hidden',
        )}
      >
        <GameInfo game={game} showSeo />
      </div>

      {/* The toolbar is hidden in fullscreen, so the way back is a floating
          button pinned to the fullscreened shell's viewport — `fixed` resolves
          against the fullscreen element, which is the shell. */}
      {fullscreen && (
        <button
          type="button"
          aria-label="Leave fullscreen"
          onClick={() => onFullscreen(false)}
          className="fixed bottom-6 right-6 z-50 flex h-10 w-10 items-center justify-center rounded-full border border-beerus bg-goku text-bulma shadow-lg"
        >
          <Icon name="shrink" size={18} />
        </button>
      )}
    </div>
  );
}

/** The aggregator frame's box — the reference's exact ratio stack. */
function FrameBox({ children }) {
  return (
    <div className="grid aspect-[9/16] w-full place-items-center self-stretch overflow-hidden rounded-lg bg-goku max-h-[80svh] min-h-[400px] md:aspect-[1.78]">
      {children}
    </div>
  );
}

/** The Fun/Real switch, read off the reference's own — two pills in a well,
 *  the active one filled. */
function ModeSwitch({ mode, pending, onChoose }) {
  const fun = mode !== 'real';
  return (
    <div role="group" aria-label="Play mode" className="flex w-fit items-center gap-1 rounded-lg border border-beerus bg-goku p-1">
      <SwitchItem active={fun} icon="smile" label="Fun" onClick={() => !fun && onChoose('fun')} disabled={pending} />
      <SwitchItem active={!fun} icon="video" label="Real" onClick={() => fun && onChoose('real')} disabled={pending} />
    </div>
  );
}

function SwitchItem({ active, icon, label, onClick, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60',
        active ? 'bg-gohan text-bulma shadow-sm' : 'text-trunks hover:text-bulma',
      )}
    >
      <Icon name={icon} size={16} className={cn(!active && 'opacity-60')} />
      {label}
    </button>
  );
}

function ToolbarButton({ label, onClick, children, ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-10 w-10 items-center justify-center rounded-full text-trunks transition-colors hover:text-bulma"
      {...props}
    >
      {children}
    </button>
  );
}

function ChooseMode({ game }) {
  return (
    <div className="text-center">
      <span className="mx-auto grid size-16 place-items-center rounded-full bg-piccolo text-goten">
        <Icon name="play" size={28} className="ms-1" />
      </span>
      <p className="mt-4 font-secondary text-lg font-medium text-bulma">{game.title}</p>
      <p className="mt-1 text-xs text-trunks">Choose fun or real mode to open the game.</p>
    </div>
  );
}

/** An in-house original this client cannot draw yet — see `Play`'s header. */
function NotBuilt({ game }) {
  return (
    <FrameBox>
      <div className="text-center">
        <span className="mx-auto grid size-16 place-items-center rounded-full bg-goten/10 text-goten">
          <Icon name="bolt" size={28} />
        </span>
        <p className="mt-4 font-secondary text-lg font-medium text-bulma">{game.title}</p>
        <p className="mx-auto mt-1 max-w-[380px] text-xs leading-relaxed text-trunks">
          This original runs on the platform already. The client for it is not built yet — Limbo is
          the one wired up so far.
        </p>
      </div>
    </FrameBox>
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
      <p className="mt-3 text-sm font-medium text-bulma">
        {NOT_CONFIGURED.has(code)
          ? 'Provider not configured'
          : `${mode === 'fun' ? 'Fun mode' : 'Real mode'} could not start`}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-trunks">{message}</p>
      {/* The code, because it is what a support ticket or a deployment check
          is actually about. */}
      <p className="mt-3 font-mono text-[10px] text-trunks/50">{code}</p>
    </div>
  );
}