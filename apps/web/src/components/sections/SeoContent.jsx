import { useId, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';

/**
 * Long-form content block.
 *
 * The reference page keeps this collapsed behind a "read more" control (its
 * markup carries `group-[.open]/collapsed:` variants), which keeps a tall wall
 * of SEO copy from pushing the footer far down the page. Same idea here, done
 * with a disclosure button and a max-height transition.
 *
 * Copy is original to this project.
 */
export function SeoContent() {
  const [open, setOpen] = useState(false);
  const contentId = useId();

  return (
    <section className="py-10 md:py-14">
      <h2 className="font-secondary text-xl font-light leading-8 text-bulma md:text-2xl">
        Playing casino games with crypto
      </h2>

      <div
        id={contentId}
        className={cn(
          'relative mt-4 overflow-hidden transition-[max-height] duration-500 ease-in-out',
          open ? 'max-h-[3000px]' : 'max-h-64',
        )}
      >
        <div className="prose-sm max-w-3xl space-y-6 text-sm leading-6 text-trunks">
          <p>
            A crypto casino works like any other online casino, with one
            difference that matters: the money moves on a public network rather
            than through a card processor. That changes the timing more than
            anything else — deposits confirm in the time it takes a block to
            settle, and withdrawals do not sit in a batch waiting for a banking
            day to start.
          </p>

          <div>
            <h3 className="font-secondary text-base font-medium text-bulma">
              Slot games
            </h3>
            <p className="mt-1.5">
              Slots are the largest category by a wide margin. Modern titles run
              on a certified random number generator, and the studio publishes a
              return-to-player percentage and a volatility rating. High
              volatility means longer dry spells and larger occasional wins; low
              volatility pays smaller amounts more often. Neither is better —
              they suit different bankrolls and different patience levels.
            </p>
          </div>

          <div>
            <h3 className="font-secondary text-base font-medium text-bulma">
              Live casino
            </h3>
            <p className="mt-1.5">
              Live games stream a real dealer from a studio floor, with bets
              placed through an overlay on the video. Because a human is
              dealing, rounds run on a fixed clock rather than at your pace, and
              table limits are posted before you sit down.
            </p>
          </div>

          <div>
            <h3 className="font-secondary text-base font-medium text-bulma">
              Table games
            </h3>
            <p className="mt-1.5">
              The classics, available both as software titles and live tables.
              The house edge is fixed and published for each one:
            </p>
            <ul className="mt-2 grid gap-1.5 ps-4">
              {[
                ['Blackjack', 'The lowest house edge of the group when basic strategy is followed correctly.'],
                ['Baccarat', 'Simple to learn — three bets, and the banker bet carries the better odds.'],
                ['Roulette', 'Single-zero wheels are meaningfully better for the player than double-zero.'],
                ['Poker', 'Table variants play against the house rather than against other players.'],
                ['Craps', 'A wide spread of bets, with the line bets offering by far the best value.'],
              ].map(([name, note]) => (
                <li key={name} className="list-disc">
                  <span className="font-medium text-bulma">{name}</span> — {note}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="font-secondary text-base font-medium text-bulma">
              Crash and instant win
            </h3>
            <p className="mt-1.5">
              Crash games run a rising multiplier that ends at an unpredictable
              point; you choose when to cash out. Instant-win titles resolve in a
              single action. Both are short-format games, which makes setting a
              session limit before you start more useful here than anywhere else
              on the site.
            </p>
          </div>
        </div>

        {!open && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-linear-to-t from-goku to-transparent"
          />
        )}
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={contentId}
        className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-piccolo hover:underline"
      >
        {open ? 'Show less' : 'Read more'}
        <Icon
          name="chevron-down"
          size={16}
          className={cn('transition-transform', open && 'rotate-180')}
        />
      </button>
    </section>
  );
}
