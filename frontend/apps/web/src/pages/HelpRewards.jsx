import { Link } from 'react-router-dom';
import { SUPPORT_EMAIL } from '@/lib/site';
import { Brand } from '@/components/ui/Brand';
import { withBrand } from '@/lib/branding';
import { useSiteName } from '@/queries/siteConfig';

const ARTICLES = [
  ['Tournaments on Bitcasino', '/help-center/help-your-bonuses/tournaments-on-bitcasino'],
  ['Casino Boosts', '/help-center/help-your-bonuses/casino-boosts'],
  ['How do I enable a reward?', '/help-center/help-your-bonuses/how-do-i-enable-a-bonus-'],
  ['Bitcasino Reward System', '/help-center/help-your-bonuses/bitcasino-bonus-system'],
  ['How do I get free spins at Bitcasino?', '/help-center/help-your-bonuses/how-do-i-get-free-spins'],
  ['What are the reward wagering requirements?', '/help-center/help-your-bonuses/what-are-the-bonus-wagering-restrictions-'],
  ['How many rewards can I use at once?', '/help-center/help-your-bonuses/how-many-bonuses-can-i-use-at-once-'],
  ['What rewards am I eligible for?', '/help-center/help-your-bonuses/what-bonuses-am-i-eligible-for-'],
];

function Breadcrumbs() {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-bulma">
      <Link to="/" className="hover:text-piccolo"><Brand /></Link>
      <span aria-hidden="true">›</span>
      <Link to="/help-center" className="hover:text-piccolo">Help centre</Link>
      <span aria-hidden="true">›</span>
      <span>Your rewards</span>
    </nav>
  );
}

export function HelpRewards() {
  const site = useSiteName();
  return (
    <div className="w-full max-w-[99rem] overflow-x-clip">
      <div className="grid gap-6">
        <Breadcrumbs />

        <header className="grid gap-1">
          <span className="text-[10px] uppercase leading-4 tracking-[0.5px] text-trunks">Help Centre</span>
          <h1 className="font-primary text-2xl font-normal leading-8 text-bulma">Your rewards</h1>
        </header>

        <section aria-labelledby="rewards-support-heading" className="grid grid-cols-1 gap-4 pb-6 md:grid-cols-3">
          <h2 id="rewards-support-heading" className="sr-only">Rewards support articles</h2>
          {withBrand(ARTICLES, site).map(([label, to]) => (
            <div key={label} className="grid self-start gap-1">
              <span className="text-[10px] uppercase leading-4 tracking-[0.5px] text-trunks">Support</span>
              <Link to={to} className="text-xl leading-8 text-bulma transition-colors hover:text-piccolo">{label}</Link>
            </div>
          ))}
        </section>

        {SUPPORT_EMAIL && (
          <section className="grid max-w-[596px] gap-4">
            <h2 className="text-2xl font-bold text-bulma">Other ways to get help</h2>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="flex items-center gap-4 bg-gohan px-6 py-4 text-bulma transition-colors hover:bg-beerus">
              <span aria-hidden="true" className="text-4xl leading-none">@</span>
              <span>
                <strong className="block text-xl">Email us</strong>
                <span className="text-sm text-trunks">{SUPPORT_EMAIL}</span>
              </span>
            </a>
          </section>
        )}

        <nav aria-label="Footer breadcrumb" className="flex flex-wrap items-center gap-1 pb-4 text-sm text-trunks">
          <Link to="/" className="hover:text-piccolo"><Brand /></Link>
          <span aria-hidden="true">›</span>
          <Link to="/help-center" className="hover:text-piccolo">Help centre</Link>
          <span aria-hidden="true">›</span>
          <span>Your rewards</span>
        </nav>
      </div>
    </div>
  );
}