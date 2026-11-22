import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  PromoCell,
  PromoPage,
  PromoParagraph,
  PromoSection,
  PromoSteps,
  PromoTable,
} from '@/components/sections/PromoLayout';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { useAuth } from '@/auth/AuthProvider';
import { RAFFLE } from '@/data/raffle';
import { formatBalance } from '@/lib/format';
import { useClaimRaffleTicket, useMyRaffle, useRaffle, useRaffleDraw } from '@/queries/promotions';

/**
 * `/promotions/weekly-raffle` — the weekly ticket raffle (owner `raffles`, gate `raffle`).
 *
 * `GET /user/raffle/current` (public) is the running draw and its rules; signed in,
 * `/raffle/me` adds the caller's tickets and `POST /raffle/claim` the one free ticket a week.
 * Past draws are `/raffle/draws/:number`, counted back from `latestDrawn` (draws are weekly
 * and numbered in order). Same `PromoLayout` chrome as League and the spin wheel.
 */
export function Raffle() {
  const raffle = useRaffle();
  const draw = raffle.data;

  return (
    <PromoPage promo={RAFFLE}>
      {raffle.isPending ? (
        <Skeleton className="h-64 rounded" />
      ) : raffle.isError || !draw ? (
        <p className="text-center text-base text-trunks">The raffle could not be loaded. Reload the page to try again.</p>
      ) : (
        <>
          <PromoSection>
            <PromoParagraph lead={`${formatBalance(draw.prizePoolUsd)} USD prize pool, ${draw.winners} winners.`}>
              Each winning ticket takes {formatBalance(draw.prizeUsd)} USD. This draw closes {formatWhen(draw.drawAt)}.
            </PromoParagraph>
            <PromoSteps
              steps={[
                { title: 'Wager', text: `Every ${formatBalance(draw.wagerPerTicketUsd)} USD you wager earns a ticket.` },
                { title: 'Claim', text: 'Take one free ticket every week on this page.' },
                { title: 'Win', text: 'Winning tickets are drawn at random and paid to your balance.' },
              ]}
            />
          </PromoSection>

          {draw.enabled === false ? (
            <p className="text-center text-base text-trunks">The raffle is paused at the moment.</p>
          ) : (
            <MyTickets />
          )}

          {draw.latestDrawn ? <PastDraws latest={draw.latestDrawn} /> : null}
        </>
      )}
    </PromoPage>
  );
}

/** The caller's tickets in the running draw and the free-ticket claim. */
function MyTickets() {
  const { status } = useAuth();
  const mine = useMyRaffle();
  const claim = useClaimRaffleTicket();

  if (status !== 'authenticated') {
    return (
      <PromoSection heading="Your tickets">
        <p className="my-4 text-center text-base text-bulma">
          <Link to="/login" className="text-piccolo underline">
            Log in
          </Link>{' '}
          to claim your free ticket and see your tickets.
        </p>
      </PromoSection>
    );
  }
  if (mine.isPending) return <Skeleton className="h-32 rounded" />;
  if (mine.isError) return <p className="text-center text-sm text-trunks">Your tickets could not be loaded.</p>;

  const { tickets = [], freeClaimed, wageredUsd, nextTicketInUsd } = mine.data ?? {};

  return (
    <PromoSection
      heading={`Your tickets: ${tickets.length}`}
      blurb={`Wagered this draw: ${formatBalance(wageredUsd ?? '0')} USD · next ticket in ${formatBalance(nextTicketInUsd ?? '0')} USD`}
    >
      <div className="mx-auto grid max-w-[26rem] gap-4">
        <Button fullWidth disabled={freeClaimed || claim.isPending} onClick={() => claim.mutate()}>
          {freeClaimed ? 'Free ticket claimed' : claim.isPending ? 'Claiming…' : 'Claim free ticket'}
        </Button>
      </div>
      {tickets.length > 0 && <TicketList tickets={tickets} />}
    </PromoSection>
  );
}

function TicketList({ tickets }) {
  return (
    <ul className="mt-4 flex flex-wrap justify-center gap-2">
      {tickets.map((ticket) => (
        <li
          key={ticket.ticket}
          className="rounded-i-sm border border-beerus bg-gohan px-3 py-1 text-sm text-bulma tabular-nums"
          title={ticket.source === 'FREE' ? 'Free ticket' : 'Wager ticket'}
        >
          #{ticket.ticket}
          {ticket.source === 'FREE' && <span className="ms-1 text-xs text-trunks">free</span>}
        </li>
      ))}
    </ul>
  );
}

/** One drawn draw at a time, newest first, with older/newer steps. */
function PastDraws({ latest }) {
  const { status } = useAuth();
  const [number, setNumber] = useState(latest);
  const draw = useRaffleDraw(number);

  if (status !== 'authenticated') return null;

  return (
    <PromoSection heading={`Past draw #${number}`} blurb={draw.data?.drawAt && `Drawn ${formatWhen(draw.data.drawAt)}`}>
      <div className="mb-4 flex justify-center gap-2">
        <Button size="sm" variant="secondary" disabled={number <= 1} onClick={() => setNumber(number - 1)}>
          Older
        </Button>
        <Button size="sm" variant="secondary" disabled={number >= latest} onClick={() => setNumber(number + 1)}>
          Newer
        </Button>
      </div>

      {draw.isPending ? (
        <Skeleton className="h-40 rounded" />
      ) : draw.isError ? (
        <p className="text-center text-sm text-trunks">No results for this draw.</p>
      ) : (
        <>
          {(draw.data?.winners ?? []).length === 0 ? (
            <p className="text-center text-sm text-trunks">This draw had no winners.</p>
          ) : (
            <PromoTable columns={['Ticket', 'Player', 'Tickets held', 'Prize (USD)']} widths={['25%', '30%', '20%', '25%']}>
              {draw.data.winners.map((row, index) => (
                <tr key={`${row.ticket}-${index}`}>
                  <PromoCell className="tabular-nums">#{row.ticket ?? '—'}</PromoCell>
                  <PromoCell>{row.player || '—'}</PromoCell>
                  <PromoCell className="tabular-nums">{row.count}</PromoCell>
                  <PromoCell className="tabular-nums">{formatBalance(row.prizeUsd)}</PromoCell>
                </tr>
              ))}
            </PromoTable>
          )}
          {(draw.data?.myTickets ?? []).length > 0 && (
            <>
              <p className="mt-4 text-center text-base text-bulma">Your tickets in this draw</p>
              <TicketList tickets={draw.data.myTickets} />
            </>
          )}
        </>
      )}
    </PromoSection>
  );
}

function formatWhen(value) {
  if (!value) return '';
  return new Date(value).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
