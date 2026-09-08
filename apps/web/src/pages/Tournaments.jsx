import { Rail } from '@/components/sections/Rail';
import { TournamentCard } from '@/components/sections/TournamentCard';
import { Icon } from '@/components/ui/Icon';
import { ACTIVE_TOURNAMENTS, FINISHED_TOURNAMENTS } from '@/data/tournaments';

/**
 * `/tournaments` — where the sidebar's Tournaments link, the account menu's
 * Tournaments row and the home page's weekly-tournament promo card all land.
 * Until now every one of them redirected to `/`.
 *
 * The column, read off the reference's own DOM at a 1536px viewport:
 *
 *     y 104  h  32   the `Tournaments` h1, 24px/32 in `bulma`
 *     y 144  h 441   `Active now (n)` + `See all`, then the rail
 *     y 593  h 196   `Coming soon`, then the empty panel
 *     y 797  …       `Finished (n)` + `See all`, then the rail
 *
 * Two things fall out of that and are easy to get wrong:
 *
 * 1. Each block is `grid gap-2` — an 8px gap between a section's heading line
 *    and its content, not the 20px a lobby rail uses. The page is dense on
 *    purpose; the cards are 394px tall and the headings have to sit close to
 *    them to read as labels rather than as bands.
 * 2. `Coming soon` is `bulma` while `Active now` and `Finished` are `trunks`.
 *    That is measured, not a slip in transcription — the reference really does
 *    paint the middle heading darker than the two either side of it. It is
 *    reproduced rather than harmonised, which is this project's default; if it
 *    ever looks like a bug worth diverging on, `docs/11` is where that goes.
 *
 * The empty `Coming soon` panel is not conditional. The reference renders it
 * whether or not anything is scheduled — it is the section's whole content,
 * an announcement that more are coming rather than a fallback for an empty
 * list — so there is no list here to be empty.
 */
export function Tournaments() {
  return (
    <div className="flex flex-col gap-2 py-2">
      <h1 className="font-primary text-2xl leading-8 font-normal tracking-normal text-bulma">
        Tournaments
      </h1>

      <TournamentRail
        title={`Active now (${ACTIVE_TOURNAMENTS.length})`}
        href="/tournaments/all/current"
        tournaments={ACTIVE_TOURNAMENTS}
      />

      <section className="grid gap-2">
        <h2 className="text-lg leading-7 font-normal text-bulma">Coming soon</h2>
        <ComingSoon />
      </section>

      <TournamentRail
        title={`Finished (${FINISHED_TOURNAMENTS.length})`}
        href="/tournaments/all/past"
        tournaments={FINISHED_TOURNAMENTS}
      />
    </div>
  );
}

/**
 * `Rail` with the page's own heading scale.
 *
 * `gap-2` overrides the rail's default `gap-5` — `cn` is `twMerge`, so the
 * later class wins rather than both landing in the list.
 */
function TournamentRail({ title, href, tournaments }) {
  if (tournaments.length === 0) return null;

  return (
    <Rail
      title={title}
      href={href}
      className="gap-2"
      headingClassName="font-primary text-lg font-normal leading-6 text-trunks md:text-lg"
    >
      {tournaments.map((tournament) => (
        <div key={tournament.slug} className="w-[36.125rem] max-w-[85vw]">
          <TournamentCard tournament={tournament} />
        </div>
      ))}
    </Rail>
  );
}

/**
 * The `Coming soon` panel: 160px tall, `gohan`, a mark on the start side and
 * one 20px line of copy beside it. The reference stacks it centred below `lg`
 * and runs it as a row above, which is what the `lg:` switches do.
 *
 * The reference's mark is a small illustration served from its CMS; this is
 * the trophy from the icon set on the same `goku` disc the tournament cards
 * use for their own mark, so the two read as one family.
 */
function ComingSoon() {
  return (
    <div className="flex flex-col items-center rounded-s-md bg-gohan p-16 lg:flex-row lg:p-10">
      <span className="grid size-16 shrink-0 place-items-center rounded-full bg-goku text-piccolo shadow-[0_0_0.75rem_rgba(15,22,31,0.1)]">
        <Icon name="trophy" size={32} />
      </span>

      <div className="max-w-sm text-center lg:ml-6 lg:text-left xl:max-w-4xl">
        <p className="text-xl font-medium leading-7 text-bulma">
          Stay tuned! More tournaments are coming your way soon.
        </p>
      </div>
    </div>
  );
}
