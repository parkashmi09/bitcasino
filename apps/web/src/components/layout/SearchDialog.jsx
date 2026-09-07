import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GameCard } from '@/components/sections/GameCard';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { GAMES } from '@/data/catalog';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';

/**
 * Search.
 *
 * The reference has no `/search` route — `bitcasino.io/search` is a 404. Its
 * search is a dialog the header field opens over whatever page you are on, so
 * this is one too: a centred card from `md` up and a full-bleed sheet below
 * it, which is the reference's own `max-md:h-full max-md:rounded-none` form.
 *
 * The dialog's own geometry is the reference's, breakpoint for breakpoint:
 * `85vw x 56vw` (capped at 90vh) through the tablet range, then a fixed
 * 1096px card whose height steps 640 → 700 → 744 as the viewport passes
 * 1280, 1440 and 1536. Those last three are written as raw media queries
 * rather than `xl:`/`2xl:` because this project remaps `--breakpoint-xl` to
 * 1200 and the reference's steps are on Tailwind's stock values.
 *
 * Layout inside is four rows in a `gap-3` column: the field row, the filter
 * pills, then the scrolling result area, which carries the count heading and
 * the grid. The grid steps 3 → 5 → 7 → 8 columns on the same four widths.
 *
 * Three pieces move between breakpoints, all of them the reference's:
 *
 * - "Random Game" sits beside the field on `md`, and becomes a floating pill
 *   fixed above the safe area on a phone, where the field row has no space
 *   for it.
 * - "Load more" is a desktop affordance only. Below `md` the reference drops
 *   the button and pages the list in as you reach the end of the scroller.
 * - The empty state's card illustration is hidden on a phone, where the sheet
 *   is short enough that the message alone has to carry it.
 */

/** The reference's four pills, in its order. `''` is "no category filter". */
const FILTERS = [
  { value: '', label: 'All' },
  { value: 'video-slots', label: 'Slots' },
  { value: 'live-casino', label: 'Live Casino' },
  { value: 'originals', label: 'Originals' },
];

/**
 * Games per page. The reference serves 30 against a catalogue of thousands;
 * this one holds 24, so the number is scaled to keep the behaviour — a first
 * page, a "Load more", then the rest — rather than the constant, which would
 * make the control dead code here.
 */
const PAGE_SIZE = 16;

/** Matches the dialog's enter/leave animations in index.css. */
const ANIMATION_MS = 150;

const match = (game, query) =>
  game.title.toLowerCase().includes(query) || game.provider.toLowerCase().includes(query);

export function SearchDialog({ open, onClose }) {
  const navigate = useNavigate();
  const desktop = useMediaQuery('(min-width: 768px)');

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const [pages, setPages] = useState(1);
  // The panel stays mounted for one animation after `open` goes false, so the
  // reference's zoom-out is not cut off by React unmounting the tree.
  const [closing, setClosing] = useState(false);
  const [atEnd, setAtEnd] = useState(true);

  const inputRef = useRef(null);
  const scrollRef = useRef(null);
  const openerRef = useRef(null);

  const term = query.trim().toLowerCase();
  const pool = filter ? GAMES.filter((game) => game.category === filter) : GAMES;
  const results = term ? pool.filter((game) => match(game, term)) : pool;

  // A search that matched nothing falls back to the popular list, which the
  // reference runs *under* the empty state rather than instead of it.
  const nothingFound = term !== '' && results.length === 0;
  const list = nothingFound ? pool : results;
  const visible = list.slice(0, pages * PAGE_SIZE);
  const hasMore = visible.length < list.length;

  // Opening: remember where focus came from, take it, and lock the page under
  // the dialog. Closing is the same in reverse, once the animation has run.
  useEffect(() => {
    if (!open) return undefined;

    openerRef.current = document.activeElement;
    setClosing(false);
    setQuery('');
    setFilter('');
    setPages(1);

    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);

    return () => {
      window.clearTimeout(id);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  const close = useCallback(() => {
    setClosing(true);
    window.setTimeout(() => {
      setClosing(false);
      onClose();
      openerRef.current?.focus?.();
    }, ANIMATION_MS);
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  /**
   * The bottom fade only reads as "there is more below" while there is, so it
   * tracks the scroller rather than sitting at a constant opacity. Measured
   * on scroll and again whenever the list changes, since filtering can leave
   * a grid that no longer overflows.
   */
  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setAtEnd(el.scrollHeight - el.scrollTop - el.clientHeight < 8);
  }, []);

  useLayoutEffect(measure, [measure, visible.length, open]);

  const onScroll = () => {
    measure();
    const el = scrollRef.current;
    // Below `md` the reference has no "Load more" — the next page arrives as
    // you reach the end of the scroller instead.
    if (!desktop && hasMore && el.scrollHeight - el.scrollTop - el.clientHeight < 240) {
      setPages((page) => page + 1);
    }
  };

  const reset = (next) => {
    next();
    setPages(1);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  const randomGame = () => {
    const game = GAMES[Math.floor(Math.random() * GAMES.length)];
    close();
    navigate(`/play/${game.category}/${game.slug}`);
  };

  if (!open && !closing) return null;

  const leaving = closing || !open;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        role="presentation"
        onClick={close}
        className={cn(
          'absolute inset-0 bg-popo/50',
          leaving ? 'animate-overlay-out' : 'animate-overlay-in',
        )}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search for games and providers"
        className={cn(
          'relative flex w-full flex-col gap-3 bg-goku px-4 pt-4 pb-0 text-sm text-bulma',
          'shadow-lg ring-1 ring-bulma/10 outline-none',
          // Phone: a full-bleed sheet. From `md`: the reference's card.
          'h-full max-md:rounded-none',
          'md:h-[56vw] md:max-h-[90vh] md:max-w-[85vw] md:rounded-i-sm',
          '[@media(min-width:1280px)]:h-[640px] [@media(min-width:1280px)]:max-w-[1096px]',
          '[@media(min-width:1440px)]:h-[700px]',
          '[@media(min-width:1536px)]:h-[744px]',
          leaving ? 'animate-dialog-out' : 'animate-dialog-in',
        )}
      >
        <div className="flex items-center gap-2">
          <div
            className={cn(
              'group relative flex h-11 w-full min-w-0 items-center gap-2 rounded-i-sm',
              'border-[0.8px] border-beerus bg-gohan px-3 transition-colors',
              'focus-within:border-piccolo focus-within:ring-3 focus-within:ring-piccolo/50',
            )}
          >
            <Icon name="search" size={16} className="text-trunks" />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(event) => reset(() => setQuery(event.target.value))}
              placeholder="Search for games and providers"
              aria-label="Search for games and providers"
              className={cn(
                'h-full min-w-0 flex-1 bg-transparent text-base text-bulma outline-none',
                'placeholder:text-trunks md:text-sm',
                '[&::-webkit-search-cancel-button]:hidden',
              )}
            />
            {query !== '' && (
              <button
                type="button"
                onClick={() => reset(() => setQuery(''))}
                className="shrink-0 cursor-pointer rounded-i-xs px-1.5 py-1 text-sm font-medium text-trunks transition-colors hover:text-bulma"
              >
                Clear search
              </button>
            )}
          </div>

          {/* Hidden while the empty state is up, which carries its own copy —
              the reference moves the button rather than showing two. */}
          {!nothingFound && (
            <Button
              size="lg"
              onClick={randomGame}
              className={cn(
                'shrink-0 active:translate-y-px',
                'max-md:fixed max-md:bottom-6 max-md:left-1/2 max-md:z-3 max-md:-translate-x-1/2',
                'max-md:pb-[env(safe-area-inset-bottom)]',
              )}
            >
              <Icon name="dice" size={16} />
              Random Game
            </Button>
          )}

          <button
            type="button"
            onClick={close}
            aria-label="Close search"
            className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-i-sm bg-goku text-bulma transition-colors hover:bg-heles"
          >
            <Icon name="close" />
          </button>
        </div>

        <div className="no-scrollbar w-full overflow-x-auto">
          <div className="flex w-fit items-center gap-2">
            {FILTERS.map((option) => (
              <Chip
                key={option.value || 'all'}
                variant="tint"
                active={filter === option.value}
                onClick={() => reset(() => setFilter(option.value))}
                className="h-10"
              >
                {option.label}
              </Chip>
            ))}
          </div>
        </div>

        <div className="relative min-h-0 flex-1">
          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="no-scrollbar h-full overflow-y-auto pb-4"
          >
            {nothingFound && (
              <div className="flex flex-col items-center justify-center gap-4 py-10 text-center">
                {/* Three stacked tiles behind a magnifier — the reference's own
                    empty illustration, and like it, absent on a phone. */}
                <div className="relative hidden h-40 w-40 items-center justify-center md:flex">
                  <span className="absolute h-28 w-20 -translate-x-10 translate-y-2 -rotate-12 rounded-i-sm bg-linear-to-b from-hit to-transparent" />
                  <span className="absolute h-28 w-20 translate-x-10 translate-y-2 rotate-12 rounded-i-sm bg-linear-to-b from-hit to-transparent" />
                  <span className="absolute h-28 w-20 rounded-i-sm bg-gohan" />
                  <Icon name="search" size={48} className="relative text-trunks" />
                </div>

                <div className="flex flex-col gap-1">
                  <p className="font-primary text-lg font-bold text-bulma md:text-2xl">
                    Nothing found
                  </p>
                  <p className="text-sm font-semibold text-trunks md:text-base">
                    Try your luck with a random game?
                  </p>
                </div>

                <Button size="lg" onClick={randomGame} className="active:translate-y-px">
                  <Icon name="dice" size={16} />
                  Random Game
                </Button>
              </div>
            )}

            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-primary text-xl font-semibold text-bulma">
                {term && !nothingFound ? 'Results' : 'Most Popular Games'}
              </h3>
              {/* The reference labels a real result set with its size and
                  leaves the fallback suggestions uncounted. */}
              {!nothingFound && (
                <span className="inline-flex shrink-0 items-center rounded-full bg-gohan px-2 py-0.5 text-xs font-medium text-bulma">
                  {list.length}
                </span>
              )}
            </div>

            <ul
              onClick={(event) => event.target.closest('a') && close()}
              className={cn(
                'grid grid-cols-3 gap-2 md:grid-cols-5',
                '[@media(min-width:1280px)]:grid-cols-7',
                '[@media(min-width:1440px)]:grid-cols-8',
              )}
            >
              {visible.map((game) => (
                <li key={game.id}>
                  <GameCard game={game} className="w-full" />
                </li>
              ))}
            </ul>
          </div>

          {/* Fade over the last row, and the pill that sits on it. Both belong
              to the scroll area rather than the grid, so they stay put while
              it moves; the fade bleeds into the dialog's own padding. It says
              "there is more" — so it is up while the scroller has further to
              go *or* while a page is still unloaded, which is also what keeps
              the white "Load more" pill legible. */}
          <div
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-x-[-1rem] bottom-0 z-2 h-16 rounded-i-sm',
              'bg-linear-to-t from-popo to-transparent transition-opacity duration-300',
              atEnd && !hasMore ? 'opacity-0' : 'opacity-50',
            )}
          />

          {hasMore && (
            <div className="absolute inset-x-0 bottom-0 z-3 flex justify-center py-2 max-md:hidden">
              <button
                type="button"
                onClick={() => setPages((page) => page + 1)}
                className={cn(
                  'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-2.5',
                  'border border-goten/30 bg-transparent text-sm font-medium text-goten',
                  'backdrop-blur-2xl transition-colors hover:bg-goten/10 active:translate-y-px',
                )}
              >
                Load more
                <Icon name="chevron-down" size={16} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
