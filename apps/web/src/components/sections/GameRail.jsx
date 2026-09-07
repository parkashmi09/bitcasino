import { GameCard } from './GameCard';
import { Rail } from './Rail';

/**
 * Horizontally scrolling row of game tiles.
 *
 * The header, scroller and paging arrows all live in `Rail`, which the
 * testimonials row uses too — the reference site gives both the same chrome.
 *
 * `featured` renders the 1.3:1 artwork, used by the first rail on the home page.
 */
export function GameRail({ title, href, games, featured = false }) {
  if (games.length === 0) return null;

  return (
    <Rail title={title} href={href}>
      {games.map((game) => (
        <GameCard
          key={game.id}
          game={game}
          wide={featured}
          className={featured ? 'w-[216px] md:w-[244px]' : 'w-[124px] md:w-[140px]'}
        />
      ))}
    </Rail>
  );
}
