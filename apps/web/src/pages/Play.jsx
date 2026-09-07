import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { GameRail } from '@/components/sections/GameRail';
import { GAMES } from '@/data/catalog';

/**
 * Game detail shell. The frame is a placeholder — a real deployment swaps it
 * for the provider's launch iframe, which is why the aspect ratio and the
 * fun/real mode controls are already in place.
 */
export function Play() {
  const { slug } = useParams();
  const game = GAMES.find((g) => g.slug === slug);

  if (!game) {
    return (
      <div className="py-20 text-center">
        <h1 className="font-secondary text-2xl font-normal text-bulma">Game not found</h1>
        <Link to="/" className="mt-3 inline-block text-sm text-piccolo hover:underline">
          Back to the lobby
        </Link>
      </div>
    );
  }

  const similar = GAMES.filter(
    (g) => g.category === game.category && g.id !== game.id,
  );

  return (
    <div className="py-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-trunks">
          <Link to="/" className="hover:text-piccolo">Lobby</Link>
          <Icon name="chevron-right" size={12} />
          <Link to={`/categories/${game.category}`} className="hover:text-piccolo">
            {game.category.replace('-', ' ')}
          </Link>
        </div>

        <div className="mt-3 grid aspect-video w-full place-items-center overflow-hidden rounded-s-md bg-popo">
          <div className="text-center">
            <span className="mx-auto grid size-16 place-items-center rounded-full bg-piccolo text-goten">
              <Icon name="play" size={28} className="ms-1" />
            </span>
            <p className="mt-4 font-secondary text-lg font-medium text-goten">
              {game.title}
            </p>
            <p className="mt-1 text-xs text-goten/60">
              Provider frame mounts here
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div>
            <h1 className="font-secondary text-lg font-medium text-bulma">{game.title}</h1>
            <p className="text-xs text-trunks">{game.provider}</p>
          </div>
          <div className="ms-auto flex gap-2">
            <Button variant="secondary">Fun mode</Button>
            <Button>Real mode</Button>
          </div>
        </div>
      </div>

      {similar.length > 0 && (
        <div className="mt-6">
          <GameRail
            title="Similar games"
            href={`/categories/${game.category}`}
            games={similar}
          />
        </div>
      )}
    </div>
  );
}
