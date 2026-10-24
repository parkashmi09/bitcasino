import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { useFavourites } from '@/hooks/useFavourites';
import { cn } from '@/lib/cn';

/**
 * The play page's Like and Favourite toggles.
 *
 * The reference draws both with counts beside them — a heart over a total of
 * likes, a star for the player's favourites. Neither total exists in the
 * platform data: there is no likes table and no favourites table, and inventing
 * one would be a claim the catalogue cannot support. These are therefore local
 * only — one JSON key per player in `localStorage`, persisted across reloads,
 * the same carve-out `WalletSettings` already makes for a preference that is
 * useful entirely on this device.
 *
 * The heart prints a count so it matches the reference's shape, but the count
 * is honest: it is this player's own like, 0 or 1, not a fake aggregate.
 */

const LIKES = 'bitcasino:likes';

/** Read this player's flag for one game, ignoring a missing/corrupt key. */
function readFlag(key, id) {
  try {
    return Boolean(JSON.parse(localStorage.getItem(key) ?? 'null')?.[id]);
  } catch {
    return false;
  }
}

function writeFlag(key, id, value) {
  try {
    const all = JSON.parse(localStorage.getItem(key) ?? 'null') ?? {};
    all[id] = value;
    localStorage.setItem(key, JSON.stringify(all));
  } catch {
    // A full or blocked localStorage is not worth a broken page.
  }
}

export function LikeButton({ game }) {
  const [liked, setLiked] = useState(() => readFlag(LIKES, game.id));

  const toggle = () =>
    setLiked((value) => {
      writeFlag(LIKES, game.id, !value);
      return !value;
    });

  return (
    <button
      type="button"
      data-testid="like-button"
      aria-pressed={liked}
      aria-label={`${liked ? 'Unlike' : 'Like'} ${game.title}`}
      onClick={toggle}
      className="flex h-10 flex-col items-center justify-center gap-0.5 rounded-full px-2 text-trunks transition-colors hover:text-bulma"
    >
      <Icon name="heart" size={18} className={cn(liked && 'fill-dodoria text-dodoria')} />
      <span className="text-[10px] leading-none tabular-nums">{liked ? 1 : 0}</span>
    </button>
  );
}

/**
 * The play page's star.
 *
 * `useFavourites` owns both the flag and the write now, so this button and the
 * sidebar star read one store: pressing this moves the badge and the
 * `/games/favourite` page in the same commit, which is what the reference gets
 * from its `favouriteToggle` window event and a refetch. Unlike the like above
 * it stores the whole game, because the favourites page has to draw a tile and
 * nothing else carries the art there.
 */
export function FavouriteButton({ game }) {
  const { isFavourite, toggle } = useFavourites();
  const favourite = isFavourite(game.id);

  return (
    <button
      type="button"
      data-testid="favourite-button"
      aria-pressed={favourite}
      aria-label={`${favourite ? 'Remove from' : 'Add to'} favourites`}
      onClick={() => toggle(game)}
      className="flex h-10 w-10 items-center justify-center rounded-full text-trunks transition-colors hover:text-bulma"
    >
      <Icon name="star" size={18} className={cn(favourite && 'fill-jiren text-jiren')} />
    </button>
  );
}