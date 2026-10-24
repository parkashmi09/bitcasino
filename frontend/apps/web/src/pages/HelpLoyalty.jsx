import { Link } from 'react-router-dom';

const ARTICLES = [
  ['How does the Loyalty Club work?', '/help-center/help-loyalty/how-loyalty-works'],
  ['Does my Loyalty Level expire?', '/help-center/help-loyalty/does-my-loyalty-level-expire'],
  ['What rewards can I get?', '/help-center/help-loyalty/what-loyalty-rewards-can-i-get'],
  ['Loyalty Club information and Terms & Conditions', '/help-center/help-loyalty/loyalty-programme-info-terms'],
  ['Why was my milestone reward grouped?', '/help-center/help-loyalty/why-was-my-milestone-reward-grouped'],
  ['What is the House Edge percent for each game?', '/help-center/help-loyalty/loyalty-what-is-the-house-edge-percent-for-each-game-'],
  ['What are the Loyalty Points Multipliers?', '/help-center/help-loyalty/what-are-the-loyalty-points-multipliers-'],
  ['What are the Loyalty tiers?', '/help-center/help-loyalty/what-are-the-loyalty-levels'],
];

function Breadcrumbs() {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-bulma">
      <Link to="/" className="hover:text-piccolo">Bitcasino</Link>
      <span aria-hidden="true">›</span>
      <Link to="/help-center" className="hover:text-piccolo">Help centre</Link>
      <span aria-hidden="true">›</span>
      <span>Loyalty Club</span>
    </nav>
  );
}

export function HelpLoyalty() {
  return (
    <div className="w-full max-w-[99rem] overflow-x-clip">
      <div className="grid gap-6">
        <Breadcrumbs />

        <header className="grid gap-1">
          <span className="text-[10px] uppercase leading-4 tracking-[0.5px] text-trunks">Help Centre</span>
          <h1 className="font-primary text-2xl font-normal leading-8 text-bulma">Loyalty Club</h1>
        </header>

        <section aria-labelledby="loyalty-support-heading" className="grid grid-cols-1 gap-4 pb-6 md:grid-cols-3">
          <h2 id="loyalty-support-heading" className="sr-only">Loyalty Club support articles</h2>
          {ARTICLES.map(([label, to]) => (
            <div key={label} className="grid self-start gap-1">
              <span className="text-[10px] uppercase leading-4 tracking-[0.5px] text-trunks">Support</span>
              <Link to={to} className="text-xl leading-8 text-bulma transition-colors hover:text-piccolo">{label}</Link>
            </div>
          ))}
        </section>

        <section className="grid max-w-[596px] gap-4">
          <h2 className="text-2xl font-bold text-bulma">Other ways to get help</h2>
          <a href="mailto:hello@bitcasino.io" className="flex items-center gap-4 bg-gohan px-6 py-4 text-bulma transition-colors hover:bg-beerus">
            <span aria-hidden="true" className="text-4xl leading-none">@</span>
            <span>
              <strong className="block text-xl">Email us</strong>
              <span className="text-sm text-trunks">hello@bitcasino.io</span>
            </span>
          </a>
        </section>

        <nav aria-label="Footer breadcrumb" className="flex flex-wrap items-center gap-1 pb-4 text-sm text-trunks">
          <Link to="/" className="hover:text-piccolo">Bitcasino</Link>
          <span aria-hidden="true">›</span>
          <Link to="/help-center" className="hover:text-piccolo">Help centre</Link>
          <span aria-hidden="true">›</span>
          <span>Loyalty Club</span>
        </nav>
      </div>
    </div>
  );
}