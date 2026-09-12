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
 * uniform band.
 *
 * `wide` switches to the 1.3:1 featured art — but only from `sm`. The
 * reference's featured tile is `max-w-26 max-h-35 sm:max-w-61 sm:max-h-47`,
 * i.e. a 104x140 box on a phone and a 244x188 one from `sm` — and 104x140 is
 * the portrait ratio, not the wide one. So on a phone it takes the portrait
 * crop, which puts the featured rail on the same baseline as every other rail;
 * from `sm` the wide art fills the wider box. Hence `<picture>` rather than a
 * `src`: the two crops are separate files, and loading both to hide one would
 * cost a phone an image it never shows.
 *
 * Both ratios still resolve to the same rendered height at a given breakpoint,
 * so mixed rails stay aligned.
 */
export function GameCard({ game, wide = false, className }) {
  return (
    <Link
      /* `category` is null for a game whose upstream `type` we do not map —
         `toGame` refuses to guess one, because a wrong category is worse than
         an absent one. `Play` reads only the slug, so the segment is cosmetic;
         without the fallback it interpolates the string "null" into the URL. */
      to={`/play/${game.category ?? 'games'}/${game.slug}`}
      className={cn(
        'group relative block shrink-0 overflow-hidden rounded-i-sm bg-gohan',
        wide ? 'aspect-[140/188] sm:aspect-[244/188]' : 'aspect-[140/188]',
        className,
      )}
    >
      {/* `block size-full` on the picture: it is an inline box by default, and
          the image's own `h-full` resolves against it, not against the tile. */}
      <picture className="block size-full">
        {/* 640px is `sm`. A media query cannot read the theme's breakpoint
            variable, so this is the one place that number is written out. */}
        {wide && <source media="(min-width: 640px)" srcSet={game.thumbWide} />}
        <img
          src={game.thumb}
          alt={game.title}
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
        />
      </picture>

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

      {/*
        Hover affordance, matched to the reference: a single veil that fades in
        over the *whole* tile — badges and jackpot included, hence z-3 — with a
        translucent, blurred play disc at its centre. The artwork itself never
        moves: the reference carries no scale and no lift on any of its tiles,
        so neither does this one. That fade is the only hover state on the
        reference home page, and it is identical for every game.
      */}
      <span className="pointer-events-none absolute inset-0 z-3 grid place-items-center bg-popo/60 opacity-0 transition-opacity duration-150 group-hover:opacity-90">
        <span className="grid size-12 place-items-center rounded-full bg-goten/50 backdrop-blur-sm">
          <Icon name="play" solid size={20} className="ms-0.5 text-goten" />
        </span>
      </span>
    </Link>
  );
}
