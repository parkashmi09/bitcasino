import { GameCard } from './GameCard';
import { Rail } from './Rail';

/**
 * Horizontally scrolling row of game tiles.
 *
 * The header, scroller and paging arrows all live in `Rail`, which the
 * testimonials row uses too — the reference site gives both the same chrome.
 *
 * `featured` renders the 1.3:1 artwork, used by the first rail on the home page.
 *
 * The widths are the reference's own, read off its tile: `w-[104px]
 * md:w-[124px] lg:w-[140px]`, on a 12px gap. Ours were a breakpoint ahead of
 * that — 124px where the reference is at 104 — which is a fifth too wide on
 * every phone and shows barely three tiles where the reference shows nearly
 * four. The featured tile follows `max-w-26 sm:max-w-61`: 104px on a phone,
 * where `GameCard` also drops to the portrait crop, and 244px from `sm`.
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
          className={
            featured
              ? 'w-[104px] sm:w-[244px]'
              : 'w-[104px] md:w-[124px] lg:w-[140px]'
          }
        />
      ))}
    </Rail>
  );
}
