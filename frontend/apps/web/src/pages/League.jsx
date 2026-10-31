import { Link, useSearchParams } from 'react-router-dom';
import {
  PromoCell,
  PromoFinePrint,
  PromoPage,
  PromoParagraph,
  PromoSection,
  PromoSteps,
  PromoTable,
} from '@/components/sections/PromoLayout';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { useAuth } from '@/auth/AuthProvider';
import {
  LEAGUE,
  LEAGUE_FINE_PRINT,
  LEAGUE_INTRO,
  RACE_CATEGORIES,
  leagueSteps,
} from '@/data/league';
import { formatBalance } from '@/lib/format';
import { cn } from '@/lib/cn';
import { raceTitle, useClaimRaceReward, useRaceBoards, useRaceRewards, useRaces } from '@/queries';
import { withBrand } from '@/lib/branding';
import { useSiteName } from '@/queries/siteConfig';

/**
 * `/promotions/league-of-bitcasino` — the platform's wager races.
 *
 * `GET /user/race` says which races are on (daily, weekly); `?race=` picks one
 * and defaults to the first. Its open board (`/user/race/:type/leaderboard`)
 * carries the window, the pool, the multipliers and the standings, plus the
 * caller's own `me` row when signed in. The prize ladder is the config's
 * `payout.ranks`, already priced in the payout currency.
 *
 * The page's chrome is `PromoLayout`; the copy without figures is
 * `data/league.js`.
 */
export function League() {
  const site = useSiteName();
  const [params, setParams] = useSearchParams();
  const races = useRaces();
  const configs = races.data ?? [];
  const wanted = params.get('race');
  const config = configs.find((race) => race.type === wanted) ?? configs[0];
  const [board] = useRaceBoards(config ? [config.type] : []);

  return (
    <PromoPage promo={withBrand(LEAGUE, site)}>
      <Intro />
      <MyPrizes />

      {configs.length > 1 && (
        <div role="tablist" className="flex justify-center gap-2">
          {configs.map((race) => (
            <button
              key={race.type}
              type="button"
              role="tab"
              aria-selected={race.type === config.type}
              onClick={() => setParams({ race: race.type }, { replace: true })}
              className={cn(
                'h-10 cursor-pointer rounded-i-sm px-4 text-base',
                race.type === config.type ? 'bg-piccolo text-on-piccolo' : 'bg-hit text-bulma',
              )}
            >
              {raceTitle(race.type)}
            </button>
          ))}
        </div>
      )}

      {races.isPending || board?.isPending ?
        <Skeleton className="h-64 rounded" />
      : !config || !board?.data ?
        <p className="text-center text-base text-trunks">
          No race is running right now. Check back soon.
        </p>
      : <>
          <PromoSection heading="Here's the play:">
            <PromoSteps steps={leagueSteps(board.data.winnerCount ?? config.winnerCount)} />
          </PromoSection>
          <Multipliers multipliers={board.data.multipliers ?? config.multipliers} />
          <Prizes type={config.type} board={board.data} payout={config.payout} />
          <Board board={board.data} />
        </>
      }

      <PromoFinePrint blocks={withBrand(LEAGUE_FINE_PRINT, site)} />
    </PromoPage>
  );
}

function Intro() {
  return (
    <section className="text-base leading-6 text-bulma">
      <h2 className="font-normal">{LEAGUE_INTRO.title}</h2>
      <PromoParagraph>{LEAGUE_INTRO.lede}</PromoParagraph>

      {LEAGUE_INTRO.paragraphs.map((paragraph) => (
        <PromoParagraph key={paragraph.lead} lead={paragraph.lead} block={paragraph.block}>
          {paragraph.text}
        </PromoParagraph>
      ))}
    </section>
  );
}

function Multipliers({ multipliers }) {
  const rows = Object.entries(multipliers ?? {});
  if (rows.length === 0) return null;

  return (
    <PromoSection heading="What your play is worth">
      <PromoTable columns={['Category', 'Multiplier']} widths={['50%', '50%']}>
        {rows.map(([key, value]) => (
          <tr key={key}>
            <PromoCell>{RACE_CATEGORIES[key] ?? key}</PromoCell>
            <PromoCell className="tabular-nums">{formatBalance(value)}x</PromoCell>
          </tr>
        ))}
      </PromoTable>
    </PromoSection>
  );
}

/** The pool headline and, when the operator has funded one, the ladder. */
function Prizes({ type, board, payout }) {
  const currency = board.payoutCurrency ?? board.currency;
  const ranks = payout?.ranks ?? [];

  return (
    <PromoSection
      heading={`${raceTitle(type)} prize pool: ${formatBalance(board.payoutPrizePool ?? board.prizePool)} ${currency}`}
      blurb={`${formatWindow(board.startsAt)} – ${formatWindow(board.endsAt)}`}
    >
      {ranks.length > 0 && (
        <PromoTable columns={['Position', `Prize (${payout.currency ?? currency})`]} widths={['50%', '50%']}>
          {ranks.map((row) => (
            <tr key={row.rank}>
              <PromoCell className="tabular-nums">{row.rank}</PromoCell>
              <PromoCell className="tabular-nums">{formatBalance(row.amount)}</PromoCell>
            </tr>
          ))}
        </PromoTable>
      )}
    </PromoSection>
  );
}

/** The signed-in player's settled race prizes still waiting; each one is claimed on its own. */
function MyPrizes() {
  const { user } = useAuth();
  const rewards = useRaceRewards({ enabled: Boolean(user) });
  const claim = useClaimRaceReward();
  const rows = rewards.data ?? [];
  if (!user || rows.length === 0) return null;

  return (
    <PromoSection heading="Your prizes" blurb="Your finished races paid out. Claim each prize to add it to your balance.">
      <PromoTable columns={['Race', 'Rank', 'Prize', 'Claim']} widths={['30%', '15%', '30%', '25%']}>
        {rows.map((row) => (
          <tr key={row.id}>
            <PromoCell>{raceTitle(row.type)}</PromoCell>
            <PromoCell className="tabular-nums">#{row.rank}</PromoCell>
            <PromoCell className="tabular-nums">
              {formatBalance(row.amount)} {row.currency}
            </PromoCell>
            <PromoCell>
              <Button
                size="sm"
                onClick={() => claim.mutate(row.id)}
                disabled={claim.isPending && claim.variables === row.id}
              >
                Claim
              </Button>
            </PromoCell>
          </tr>
        ))}
      </PromoTable>
    </PromoSection>
  );
}

function Board({ board }) {
  const { status } = useAuth();
  const rows = board.leaderboard ?? [];
  const currency = board.payoutCurrency ?? board.currency;

  return (
    <PromoSection heading="Leaderboard">
      {rows.length === 0 ?
        <p className="my-4 text-center text-base text-trunks">
          Nobody is on the board yet. The first settled bet takes the lead.
        </p>
      : <PromoTable
          columns={['Position', 'Player', 'Points', `Prize (${currency})`]}
          widths={['16%', '38%', '23%', '23%']}
        >
          {rows.map((row) => (
            <tr key={row.rank}>
              <PromoCell className="tabular-nums">{row.rank}</PromoCell>
              <PromoCell>{row.name ?? '—'}</PromoCell>
              <PromoCell className="tabular-nums">{formatBalance(row.points)}</PromoCell>
              <PromoCell className="tabular-nums">{formatBalance(row.payout)}</PromoCell>
            </tr>
          ))}
        </PromoTable>
      }

      <p className="text-center text-base text-bulma italic">
        {board.me ?
          `Your position: #${board.me.rank} · ${formatBalance(board.me.points)} points`
        : status === 'authenticated' ?
          'You are not on the board yet — every settled bet counts.'
        : <>
            <Link to="/login" className="text-piccolo underline">
              Log in
            </Link>{' '}
            to see your position.
          </>
        }
      </p>
    </PromoSection>
  );
}

function formatWindow(value) {
  if (!value) return '';
  return new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
