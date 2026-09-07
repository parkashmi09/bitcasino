import { Link } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { formatCompact } from '@/lib/format';
import { cn } from '@/lib/cn';

const BADGE_LABEL = {
  new: 'New',
  hot: 'Trending',
  exclusive: 'Exclusive',
  jackpot: 'High Roller',
};

const BADGE_CLASS = {
  new: 'bg-roshi text-goten',
  hot: 'bg-chichi text-goten',
  exclusive: 'bg-popo/80 text-goten',
  jackpot: 'bg-frieza text-goten',
};

/**
 * Game tile.
 *
 * The title and studio are baked into the artwork, exactly as the reference's
 * thumbnails are, so the tile carries no caption and every rail is a single
 * uniform band. `wide` switches to the 1.3:1 featured art; both ratios resolve
 * to the same rendered height at a given breakpoint, so mixed rails stay
 * aligned.
 */
export function GameCard({ game, wide = false, className }) {
  return (
    <Link
      to={`/play/${game.category}/${game.slug}`}
      className={cn(
        'group relative block shrink-0 overflow-hidden rounded-i-sm bg-gohan',
        wide ? 'aspect-[244/188]' : 'aspect-[140/188]',
        'transition-transform duration-200 will-change-transform hover:-translate-y-1',
        className,
      )}
    >
      <img
        src={wide ? game.thumbWide : game.thumb}
        alt={game.title}
        loading="lazy"
        decoding="async"
        className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
      />

      {game.badge && (
        <span
          className={cn(
            'absolute end-1.5 top-1.5 z-2 rounded-i-xs px-1.5 py-0.5 text-[10px] font-medium leading-4',
            BADGE_CLASS[game.badge],
          )}
        >
          {BADGE_LABEL[game.badge]}
        </span>
      )}

      {game.players !== undefined && (
        <span className="absolute start-1.5 top-1.5 z-2 inline-flex items-center gap-1 rounded-i-xs bg-popo/60 px-1.5 py-0.5 text-[10px] font-medium text-goten backdrop-blur-sm">
          <span className="size-1.5 rounded-full bg-roshi" />
          {formatCompact(game.players)}
        </span>
      )}

      {game.jackpot !== undefined && (
        <span className="absolute inset-x-0 bottom-0 z-2 bg-linear-to-t from-popo/90 to-transparent px-2 pb-2 pt-6 text-center">
          <span className="block font-secondary text-xs font-bold text-krillin">
            {formatCompact(game.jackpot)} USDT
          </span>
        </span>
      )}

      {/* Hover affordance: darken artwork and reveal a play control. */}
      <div className="absolute inset-0 z-1 bg-popo/0 transition-colors duration-200 group-hover:bg-popo/45" />
      <span className="absolute inset-0 z-2 grid place-items-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <span className="grid size-11 place-items-center rounded-full bg-piccolo text-goten shadow-lg">
          <Icon name="play" size={20} className="ms-0.5" />
        </span>
      </span>
    </Link>
  );
}
