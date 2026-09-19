import { useState } from 'react';
import { categoryLabel } from '@/data/categories';
import { cn } from '@/lib/cn';
import { fmt, gameMetrics } from './playMetrics';

/**
 * In the reference, `In-House` games print the operator's own name under the
 * title, exactly as the lobby tiles do — see `GameCard` for the same map and
 * why the raw value cannot be renamed at the source.
 */
const PROVIDER_LABEL = { 'In-House': 'Bitcasino' };

const thumbnailWidth =
  'w-[104px] md:w-[124px] lg:w-[140px] aspect-[210/282] rounded-lg object-cover';

/**
 * The detail page's game block — thumbnail, title, badges and description —
 * plus, on the desktop copy, the SEO section below it.
 *
 * Rendered twice, like the reference: once in the main column (`hidden
 * md:block`, with the SEO section) and once in the aside for phones
 * (`md:hidden`, no SEO, since the aside already lists what to play next). The
 * two share this component so the copy cannot drift.
 */
export function GameInfo({ game, showSeo = false, className }) {
  return (
    <section className={cn('grid gap-6', className)} aria-label={`About ${game.title}`}>
      <div className="flex gap-4">
        <img src={game.thumb} alt={game.title} className={thumbnailWidth} loading="lazy" decoding="async" />
        <div className="min-w-0 flex-1">
          <h2 className="font-secondary text-xl font-medium text-bulma md:text-2xl">{game.title}</h2>
          <Badges game={game} />
          <p data-testid="game-info-description" className="mt-4 max-w-[640px] text-sm leading-relaxed text-trunks">
            {describe(game)}
          </p>
        </div>
      </div>
      {showSeo && <GameSeo game={game} />}
    </section>
  );
}

function Badges({ game }) {
  const label = PROVIDER_LABEL[game.provider] ?? game.provider;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <Pill>{label}</Pill>
      {game.category && <Pill>{categoryLabel(game.category)}</Pill>}
      {game.rtp !== undefined && <Pill>RTP {fmt(game.rtp)}%</Pill>}
      {game.volatility && <Pill>{game.volatility} volatility</Pill>}
      {game.bonusBuy && <Pill>Bonus buy</Pill>}
    </div>
  );
}

function Pill({ children }) {
  return (
    <span className="inline-flex items-center rounded-full border border-beerus bg-goku px-3 py-1 text-xs text-trunks">
      {children}
    </span>
  );
}

/** Two honest sentences about what this game is, from fields that exist. */
function describe(game) {
  if (game.inHouse) {
    const rtp = game.rtp !== undefined ? ` Its average RTP is ${fmt(game.rtp)}%.` : '';
    return `${game.title} is one of Bitcasino's in-house originals, drawn and settled on the platform the moment you bet.${rtp} There is no external provider and no waiting.`;
  }
  const rtp = game.rtp !== undefined ? ` The average return to player is ${fmt(game.rtp)}%.` : '';
  const brand = PROVIDER_LABEL[game.provider] ?? game.provider;
  return `${game.title} is played inside a ${brand} client from the Bitcasino lobby.${rtp} Open it in the frame above with a real-money session, or use fun mode to try the game with no stake at all.`;
}

/**
 * The long SEO block under the description — clamped to `52` height units with
 * a fade until "Show more", exactly like the reference and like `SeoContent`.
 *
 * All copy is generated from fields the catalogue actually carries; the only
 * static text is what every game here is true of. There is nothing to inject,
 * so it is JSX rather than `dangerouslySetInnerHTML`.
 */
function GameSeo({ game }) {
  const [open, setOpen] = useState(false);
  const brand = PROVIDER_LABEL[game.provider] ?? game.provider;

  return (
    <div className="border-t border-beerus pt-6">
      <h4 className="font-secondary text-base font-medium text-bulma">Play {game.title} at Bitcasino</h4>

      <div
        id="game-seo-text"
        className={cn(
          'mt-3 text-sm leading-relaxed text-trunks',
          !open && 'relative max-h-52 overflow-hidden',
        )}
      >
        {!open && <span className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-gohan to-transparent" />}

        <p>
          {game.title} is available at Bitcasino{game.rtp !== undefined ? `, with an average RTP of ${fmt(game.rtp)}%` : ''}. It can be opened in
          real-money mode, which settles against your wallet, or in fun mode, which plays with no
          stake at all{game.inHouse ? ' — an in-house original, drawn and settled here on the platform' : ` — it is supplied by ${brand}`}.
        </p>
        <p className="mt-3">
          {game.inHouse
            ? `As one of Bitcasino's own originals, ${game.title} runs entirely on the platform: the multiplayer engine settles each round the moment you bet, and shows the round's identifier beside its result.`
            : `Because ${game.title} runs inside ${brand}'s own client, betting takes place in the game frame and the session is managed by ${brand}. Stakes and winnings settle against the wallet like any other game at Bitcasino.`}
        </p>

        <div className="mt-4 w-full max-w-[560px] overflow-hidden rounded-i-md border border-beerus">
          <table className="w-full text-sm">
            <tbody>
              {gameMetrics(game).map(([label, value]) => (
                <tr key={label} className="border-t border-beerus first:border-t-0">
                  <th scope="row" className="bg-goku px-3 py-2.5 text-start text-xs font-normal text-trunks">
                    {label}
                  </th>
                  <td className="px-3 py-2.5 text-end text-sm text-bulma tabular-nums">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3">
          Check the lobby for the latest promotions and the casino rules that govern every round played
          here, whatever the studio behind it.
        </p>
      </div>

      <button
        type="button"
        aria-expanded={open}
        aria-controls="game-seo-text"
        onClick={() => setOpen((value) => !value)}
        className="mt-4 text-sm font-medium text-piccolo transition-opacity hover:opacity-80"
      >
        {open ? 'Show less' : 'Show more'}
      </button>
    </div>
  );
}