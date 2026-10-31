import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BetbyIcon, IconEdit } from '../../components/exchange/icons';
import { ExposureBadge, StakeButtonsModal } from '../../components/exchange';
import { useExchangeCurrency, useSportsBalance, useStakeButtons } from '../../hooks/exchange';
import { saveStakeButtons } from '../../services/exchange';
import { toast } from '@/lib/toast';
import { BET_TOAST } from '../../utils/exchange';
import { useSession } from '../../hooks/exchange/site';
import { useGates } from '../../hooks/exchange/site';
import { stakeLabel } from './model';
/* The rail's geometry (`.sports-rail*`) is the sports lobby's own — measured off BetBy's widget
   in pages/Sports/Sports.css — so the exchange keeps hash.game's sports bar rather than drawing a
   new one. Imported, not copied. */

/* The exchange's three destinations, as rail cells with BetBy's own chrome art. */
const NAV = [
  { to: '/sports', label: 'Exchange', icon: 'ic-home', end: true },
  { to: '/sports/my-bets', label: 'My Bets', icon: 'ic-navbar-mybets' },
  { to: '/sports/statement', label: 'Statement', icon: 'ic-stat' },
];

/* The tip lives on the rail, not in the cell: `.sports-rail-scroll` scrolls on x, which makes it
   clip on y too (SportRail.jsx carries the long version). */
function tipFrom(e, label) {
  const cell = e.currentTarget;
  const scroller = cell.parentElement?.classList.contains('sports-rail-scroll') ? cell.parentElement : null;
  return { label, x: cell.offsetLeft - (scroller?.scrollLeft ?? 0) + cell.offsetWidth / 2 };
}

/**
 * The exchange's top bar — the sports rail look with Exchange / My Bets / Statement cells and,
 * signed in, the stake-buttons action on the right.
 */
export default function ExchangeRail() {
  const { pathname } = useLocation();
  // A demo account has no Statement (services/gates.js `sportsStatement`).
  const { routeOn } = useGates();
  const [tip, setTip] = React.useState(null);
  const tipProps = (label) => ({
    onMouseEnter: (e) => setTip(tipFrom(e, label)),
    onFocus: (e) => setTip(tipFrom(e, label)),
    onMouseLeave: () => setTip(null),
    onBlur: () => setTip(null),
  });

  return (
    <div className="sports-rail">
      <div className="sports-rail-scroll hide-scroll">
        {NAV.filter((item) => routeOn(item.to)).map((item) => {
          const active = item.end ? pathname === item.to || pathname === `${item.to}/` : pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              className={`sports-rail-cell ${active ? 'is-active' : ''}`}
              {...tipProps(item.label)}
            >
              <BetbyIcon name={item.icon} className="sports-rail-icon" />
            </Link>
          );
        })}
      </div>

      <ExchangeTools inRail tipProps={tipProps} />

      {tip && (
        <span className="sports-rail-tip" style={{ left: `${tip.x}px` }} role="tooltip">
          {tip.label}
        </span>
      )}
    </div>
  );
}

/**
 * Signed-in exchange tools: the stake-buttons action (opens the kit's StakeButtonsModal). Nothing
 * when signed out — saving stakes needs a player. (The sports balance / exposure badge was removed
 * at the user's request: the header balance is the one the player reads.)
 *
 * @param {{ inRail?: boolean, tipProps?: (label:string)=>object }} props
 *   `inRail` draws the action as a rail cell after a divider; otherwise as a 40px layer4 square
 *   (the account pages' heading row).
 */
export function ExchangeTools({ inRail = false, tipProps }) {
  const { session } = useSession();
  if (!session.login) return null;
  return <SignedInTools inRail={inRail} tipProps={tipProps} />;
}

function SignedInTools({ inRail, tipProps = () => null }) {
  // Stake buttons are saved in rupees and edited in the header wallet's coin.
  const cur = useExchangeCurrency();
  const { session } = useSession();
  // The player's open sports exposure (sports socket), in the header wallet's coin.
  const { exposure } = useSportsBalance({ userId: session?.userId ?? null });
  const { data: stakes, refresh } = useStakeButtons();
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(null);

  const close = () => {
    if (saving) return;
    setEditing(false);
    setError(null);
  };

  const save = async (values) => {
    setSaving(true);
    setError(null);
    try {
      await saveStakeButtons(values.map(cur.chipToInr).map((value) => ({ label: stakeLabel(value), value })));
      refresh();
      setEditing(false);
      // TENEXCH SetButtonValueModal's wording, both ways; the modal stays open on a failure.
      toast.success(BET_TOAST.STAKE_BUTTONS_SAVED);
    } catch (e) {
      const msg = e?.message || BET_TOAST.STAKE_BUTTONS_FAILED;
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-none items-center">
      {inRail && <span className="sports-rail-divider" />}
      {/* Disabled until the current list has landed: the modal seeds its draft once, at mount. */}
      <button
        type="button"
        aria-label="Stake buttons"
        disabled={!stakes}
        onClick={() => setEditing(true)}
        title={inRail ? undefined : 'Stake buttons'}
        className={
          inRail
            ? 'sports-rail-cell disabled:cursor-wait'
            : 'flex size-10 items-center justify-center rounded-lg bg-layer4 transition-colors hover:bg-layer5 disabled:cursor-wait [&_svg]:fill-secondary'
        }
        {...tipProps('Stake buttons')}
      >
        <IconEdit className="size-6" />
      </button>
      <ExposureBadge
        className="ml-1 flex-none"
        hideBalance
        balance={0}
        exposure={exposure ?? 0}
        currency={cur.prefix}
        formatAmount={cur.isInr ? undefined : cur.formatInr}
        loading={exposure == null}
        exposureLabel="Exposure"
        title="Your open sports exposure"
      />
      {editing && stakes && (
        <StakeButtonsModal
          title="Stake buttons"
          values={stakes.stakes.map((s) => cur.chipFromInr(Number(s.value)))}
          currency={cur.prefix.trim()}
          currencyName={cur.label}
          allowDecimals={!cur.isInr}
          min={cur.isInr ? 1 : 1 / 10 ** cur.decimals}
          saving={saving}
          error={error}
          onSave={save}
          onClose={close}
        />
      )}
    </div>
  );
}
