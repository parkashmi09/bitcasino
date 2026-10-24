import { Link } from 'react-router-dom';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { Icon } from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/Skeleton';
import { PromotionTabs } from '@/components/sections/PromotionList';
import { useAuth } from '@/auth/AuthProvider';
import { useBonusEvents } from '@/queries';

/**
 * `/promotions/participations` — the promotions index's second tab.
 *
 * The reference's is a single `gohan` panel: a 76px `goku` disc with a
 * calendar glyph in it, `No active participation` at 20px semibold with one
 * line under it, and a `Check promotions` button, all on one row with a 56px
 * gap and 44px of padding. That panel is reproduced below, and it is not
 * conditional on anything, because —
 *
 * ═══════════════════════════════════════════════════════════════════════
 * THIS PLATFORM HAS NO PARTICIPATION RECORD, SO THE COUNT IS ALWAYS ZERO.
 *
 * A "participation" is a player opted in to a running campaign. There is no
 * campaign table on this backend and nothing that records an opt-in — the
 * whole promotions surface is `admin/banners` (a picture and a placement),
 * the spin wheel, and `bonushistory`. So the panel above is the true state
 * of this account rather than a placeholder for a feature that is merely
 * empty today, and the tab's `0` is a fact and not a stub.
 *
 * `GET /user/bonus/events` is the nearest real thing, and it is a different
 * thing: the caller's own `bonushistory`, a log of bonuses ALREADY PAID —
 * `{id, event, amount, createdAt}`. It carries no title, no description and
 * no window, so it cannot describe a campaign. It used to be rendered on
 * `/promotions` under the heading "Running now", which is how a log of past
 * payments came to be labelled as the operator's schedule; see
 * `queries/promotions.js`. It is below, under its own name.
 * ═══════════════════════════════════════════════════════════════════════
 */
export function Participations() {
  return (
    <div className="flex max-w-[83rem] flex-col gap-6">
      <h1 className="sr-only">My participations</h1>

      <PromotionTabs participations={0} />

      <EmptyPanel />
      <BonusHistory />

      <Breadcrumb
        items={[{ label: 'Promotions', to: '/promotions' }, { label: 'Participations' }]}
        className="mt-0"
      />
    </div>
  );
}

function EmptyPanel() {
  return (
    <div className="grid items-center justify-items-center gap-14 rounded-xl bg-gohan p-10 text-center md:grid-flow-col md:p-11 md:text-left">
      {/* The reference's glyph is a calendar with a cross on it, served as a
          CMS image. `gift` is the motif this app already uses for a bonus. */}
      <div className="grid size-[184px] place-items-center rounded-full bg-goku md:size-[76px]">
        <Icon name="gift" size={40} className="text-trunks" />
      </div>

      <div className="grid gap-4">
        <h2 className="text-xl font-semibold text-bulma">No active participation</h2>
        <p className="text-base leading-6 text-bulma">
          There are no active promotions that you’re participating in
        </p>
      </div>

      <Link
        to="/promotions"
        className="flex h-10 items-center justify-center rounded-i-sm bg-piccolo px-4 text-base font-normal whitespace-nowrap text-goten transition-colors duration-200 hover:bg-piccolo-80"
      >
        Check promotions
      </Link>
    </div>
  );
}

/**
 * The player's own bonus log — the panel that used to sit on `/promotions`.
 *
 * Player-scoped: it is their history, not a catalogue, so a signed-out visitor
 * gets an invitation rather than a 401 rendered as an error.
 */
function BonusHistory() {
  const { status } = useAuth();
  const { data, isPending, isError } = useBonusEvents({ limit: 20 });

  const events = data?.events ?? [];

  if (status !== 'authenticated') {
    return (
      <Panel>
        <p className="text-sm leading-relaxed text-trunks">
          Bonuses are paid per account, so this list needs you signed in.
        </p>
        <Link
          to="/login"
          className="mt-3 flex h-10 w-max items-center justify-center rounded-i-sm bg-piccolo px-4 text-sm font-medium text-goten hover:bg-piccolo-80"
        >
          Log in
        </Link>
      </Panel>
    );
  }

  if (isPending) {
    return (
      <Panel>
        <div className="grid gap-2">
          {[0, 1].map((row) => (
            <Skeleton key={row} className="h-20 rounded-i-sm" />
          ))}
        </div>
      </Panel>
    );
  }

  if (isError) {
    return (
      <Panel>
        <p className="text-sm text-trunks">
          Could not load your bonuses. Reload the page to try again.
        </p>
      </Panel>
    );
  }

  if (events.length === 0) {
    return (
      <Panel>
        {/* Deliberately specific. "Check back soon" is what a broken fetch
            would also say; this says which mechanism is empty. */}
        <p className="text-sm leading-relaxed text-trunks">
          No bonus has been paid to this account yet. Every one that is shows up
          here with what it was and what it paid.
        </p>
      </Panel>
    );
  }

  return (
    <Panel>
      <ul className="grid gap-2">
        {events.map((event) => (
          <li
            key={event.id}
            className="flex items-baseline justify-between gap-4 rounded-i-sm bg-goku px-4 py-3"
          >
            <div>
              <h3 className="text-sm font-medium text-bulma">{event.name}</h3>
              <p className="mt-1 text-xs tabular-nums text-trunks">{formatPaidAt(event.at)}</p>
            </div>
            {/* A decimal string, printed as one. `bonushistory.amount` is
                `NUMERIC` and carries no currency column, so there is no code
                to put beside it — inventing one would label a sum in a coin
                nobody said it was paid in. */}
            <span className="shrink-0 font-secondary text-sm font-bold tabular-nums text-roshi">
              +{event.amount}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Panel({ children }) {
  return (
    <section className="grid h-max content-start gap-3 rounded-xl bg-gohan p-5">
      <h2 className="font-secondary text-lg font-medium text-bulma">Bonuses paid</h2>
      {children}
    </section>
  );
}

/**
 * When a bonus was paid.
 *
 * `createdat` is `timestamp WITHOUT time zone`, so the string arrives with no
 * offset and `Date` reads it as local. That is off by the deployment's own UTC
 * offset and it is the platform's column that is wrong, not this; a day-and-
 * month label absorbs it, which a clock time would not.
 */
function formatPaidAt(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
