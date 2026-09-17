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

/**
 * The four fills, read off the reference's own tiles.
 *
 * Three of the four are gradients it sets inline rather than through a class,
 * so they are written out here to the degree and the stop: there is no theme
 * token for any of them, and rounding `-11.86%` to `0%` visibly moves where
 * the two colours meet across a 27px chip.
 *
 * `exclusive` is the odd one out and is flat `popo` — the reference gives it a
 * class and no gradient.
 */
const BADGE_FILL = {
  new: 'linear-gradient(254deg, #8A1DFF -11.86%, #6100E2 111.41%)',
  hot: 'linear-gradient(254deg, #FF8911 -11.86%, #E74A13 111.41%)',
  jackpot: 'linear-gradient(257deg, #4B0773 0%, #FF003C 100%)',
};

/**
 * The studio line under a tile's title, where the raw provider string is not
 * what the reference prints.
 *
 * `In-House` is what the Phase 0 seeder writes for the twenty games this
 * platform deals itself — it is the value the provider filter matches on, so
 * it cannot just be renamed at the source. The reference prints `Bitcasino`
 * under its own originals, so that is what the tile shows.
 */
const PROVIDER_LABEL = { 'In-House': 'Bitcasino' };

/**
 * Game tile.
 *
 * The title and studio are set over the artwork, not baked into it — which is
 * how the reference does it, and the only arrangement that can caption a real
 * captured thumbnail as well as a generated one. Three layers over the image:
 * a scrim (`z-1`) that darkens the foot so white type is legible whatever the
 * art does down there, the caption (`z-2`), and the hover veil (`z-3`) over
 * everything.
 *
 * The type is the reference's own — `Big Shoulders` black, uppercase, over
 * `DM Sans` semibold at a flat 9px — and so are the sizes, read off its tile
 * at each breakpoint: 14/18/21px against a 104/124/140px tile.
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

      {/*
        The reference's flag is a tab hanging off the TOP EDGE, centred — not a
        pill inset in the top corner, which is what this was. It is 12px tall
        (9px semibold over a 12px line, no vertical padding), 4px of side
        padding, and rounded on its bottom two corners only, so it reads as
        part of the tile's chrome rather than as a sticker on the artwork.

        `z-4` puts it over the hover veil. The reference gives both z-3 and
        wins on source order; being explicit is clearer than depending on which
        of the two is written last, and the effect is the reference's — the
        flag stays readable while the play disc is showing.
      */}
      {game.badge && (
        <span
          style={BADGE_FILL[game.badge] ? { background: BADGE_FILL[game.badge] } : undefined}
          className={cn(
            'absolute top-0 left-1/2 z-4 -translate-x-1/2 rounded-b-xs px-1',
            'text-[9px] font-semibold leading-3 whitespace-nowrap text-goten',
            game.badge === 'exclusive' && 'bg-popo',
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

      {/* The reference's own foot scrim, to the percentage:
          `linear-gradient(180deg, transparent 31.73%, #000 100%)`. It is a
          fixed black rather than a theme colour because it sits on artwork,
          not on the page — the tile looks the same in both themes. */}
      <span className="pointer-events-none absolute inset-0 z-1 bg-[linear-gradient(180deg,transparent_31.73%,#000_100%)]" />

      {/* The reference pulls its side padding IN at `md` and back out at `lg`
          — `px-2 md:px-0 lg:px-2` — because the middle step is where the tile
          is narrowest relative to its type. */}
      <span className="pointer-events-none absolute inset-0 z-2 flex flex-col items-center px-2 pb-2 text-center md:px-0 lg:px-2">
        {/*
          A fixed 59px box, not an auto one, and a fixed caption width.

          The reference bottom-aligns the caption inside a box of that exact
          height and holds the text to 96px (124px from `md`), which is what
          keeps a two-line title and a one-line title sitting on the same
          baseline across a row — an auto-height block, which is what this was,
          lifts the longer one and the grid reads ragged. The width is what
          makes `Exclusive Salon Prive Baccarat` wrap where the reference wraps
          it rather than running the full width of the tile.

          Only the portrait tile: the featured rail's art is 1.3:1 and sets its
          own type, so a 96px cap there would wrap a title that has room.
        */}
        <span
          className={cn(
            'mt-auto flex flex-col items-center justify-end gap-1',
            !wide && 'h-[59px] w-[96px] md:w-[124px]',
          )}
        >
          {game.jackpot !== undefined && (
            <span className="font-secondary text-[10px] font-bold leading-3 text-krillin">
              {formatCompact(game.jackpot)} USDT
            </span>
          )}
          <span
            /*
              Every `leading-` sits AFTER the `text-` of its own breakpoint,
              and that is not a style preference.

              `cn` is tailwind-merge, and Tailwind's `text-lg/7` shorthand sets
              a line height — so tailwind-merge treats `font-size` as
              conflicting with `leading` and keeps whichever is written last.
              These used to read `leading-[0.97] … text-[14px]`, in that order,
              per breakpoint. Both leadings were being dropped from the class
              string before it ever reached the DOM, and the titles rendered at
              the 1.5 default: `Exclusive Speed Baccarat` broke onto three
              lines where the reference sets it in two, and the caption grew
              out of its box.

              Nothing about it looked wrong in the source, which is exactly why
              it survived. The rule is one scope, size first, leading second.
            */
            className={cn(
              'font-display font-black uppercase text-goten',
              wide
                ? 'text-[16px] leading-[0.97] sm:text-[26px] md:leading-[0.93]'
                : 'text-[14px] leading-[0.97] md:text-[18px] md:leading-[0.93]',
            )}
          >
            {game.title}
          </span>
          <span className="text-[9px] font-semibold leading-3 text-goten opacity-80">
            {PROVIDER_LABEL[game.provider] ?? game.provider}
          </span>
        </span>
      </span>

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
