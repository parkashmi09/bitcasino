import { MenuPageLayout } from '../../components/exchange/site';
import { useIsDesktop } from '../../hooks/exchange/site';
import ExchangeRail, { ExchangeTools } from './ExchangeRail';
import { useGates } from '../../hooks/exchange/site';

/* bitcasino: the exchange is INR only here, so there is no converted-currency note to show
   (hash's ExchangeCurrencyNote explains a non-INR wallet's conversion). Kept as a no-op so the
   frame and the account pages read as hash's. */
export function ExchangeCurrencyNote() {
  return null;
}

/**
 * The exchange's page frame: the sports rail across the top, then the page.
 *
 * `px-4 sm:px-0` is the sports page's own gutter pair (pages/Sports/index.jsx carries why
 * `.main-layout-content` leaves the phone gutter to each page); the rail cancels it with
 * `-mx-4 sm:mx-0` so the bar runs edge to edge on a phone, as the BetBy rail did.
 */
export default function ExchangeFrame({ children }) {
  return (
    <div className="px-4 pb-4 sm:px-0">
      <div className="-mx-4 sm:mx-0">
        <ExchangeRail />
      </div>
      <ExchangeCurrencyNote />
      {children}
    </div>
  );
}

const MENU = [
  { key: 'lobby', title: 'Exchange', href: '/sports' },
  { key: 'my-bets', title: 'My Bets', href: '/sports/my-bets' },
  { key: 'statement', title: 'Statement', href: '/sports/statement' },
];

/**
 * My Bets / Statement: an account-like page, so on a desktop it is the site's MenuPageLayout
 * (sticky heading, left menu, pane) with the exchange tools at the heading's right; below `lg`,
 * where MenuPageLayout's 240px rail has no room, the exchange frame and a heading.
 *
 * The tools carry `-my-1`: they are 40px against the heading's 32px line, and MenuPageLayout
 * pins its menu at `top-30` — the heading's height — so the row must not grow.
 */
export function ExchangeAccountPage({ title, children }) {
  const isDesktop = useIsDesktop();
  const { routeOn } = useGates();

  if (isDesktop) {
    return (
      <MenuPageLayout
        menu={MENU.filter((item) => routeOn(item.href))}
        title={
          <div className="flex items-center justify-between gap-4">
            <span>{title}</span>
            <div className="-my-1">
              <ExchangeTools />
            </div>
          </div>
        }
      >
        <ExchangeCurrencyNote className="mb-3" />
        {children}
      </MenuPageLayout>
    );
  }

  return (
    <ExchangeFrame>
      <h1 className="pb-3 pt-4 text-lg font-extrabold leading-8">{title}</h1>
      {children}
    </ExchangeFrame>
  );
}
