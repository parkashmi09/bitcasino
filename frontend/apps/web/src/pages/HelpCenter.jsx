import { Link } from 'react-router-dom';
import { findHelpCategory } from '@/data/helpArticles';

const IMAGE_ROOT = 'https://heathmont.imgix.net/bitcasino/images';

const CATEGORIES = [
  {
    id: 'help-getting-started',
    title: 'Getting Started',
    count: 11,
    icon: 'gift.svg',
    href: '/help-center/help-getting-started',
    articles: [
      ['Learn about Bitcasino Originals provably fair games', '/help-center/provably-fair'],
      ['How many games are there in Bitcasino?', '/help-center/help-getting-started/how-many-games-are-there-in-bitcasino-'],
      ['How to buy crypto using P2P on Binance in Africa?', '/help-center/help-getting-started/how-to-buy-crypto-using-p2p-on-binance'],
    ],
  },
  {
    id: 'help-your-account',
    title: 'Your Account',
    count: 11,
    icon: 'invite_friends.svg',
    href: '/help-center/help-your-account',
    articles: [
      ['What is the Vault?', '/help-center'],
      ['Responsible Gaming', '/help-center/responsible-gaming'],
      ['How to use Metamask?', '/help-center'],
    ],
  },
  {
    id: 'help-your-transactions',
    title: 'Your Transactions',
    count: 10,
    icon: 'dynamic_rewards.svg',
    href: '/help-center/help-your-transactions',
    articles: [
      ['What is the minimum deposit?', '/help-center'],
      ['What is the minimum withdrawal?', '/help-center'],
      ['How long does deposit / withdrawal take?', '/help-center'],
    ],
  },
  {
    id: 'help-your-bonuses',
    title: 'Your rewards',
    count: 8,
    icon: 'money_back.svg',
    href: '/help-center/help-your-bonuses',
    articles: [
      ['Tournaments on Bitcasino', '/help-center/help-your-bonuses/tournaments-on-bitcasino'],
      ['Casino Boosts', '/help-center/help-your-bonuses'],
      ['How do I enable a reward?', '/help-center/help-your-bonuses'],
    ],
  },
  {
    id: 'help-payment-options',
    title: 'Payment Options',
    count: 7,
    icon: 'you_play_we_pay.svg',
    href: '/help-center/help-payment-options',
    articles: [
      ['Canadian Dollar (CAD) Information', '/help-center/help-payment-options/canadian-dollar-information'],
      ['What cryptocurrencies do you support?', '/help-center'],
      ['How to deposit and withdraw via MetaMask?', '/help-center'],
    ],
  },
  {
    id: 'help-about-bitcoin',
    title: 'About Crypto',
    count: 5,
    icon: 'trophy.svg',
    href: '/help-center/help-about-bitcoin',
    articles: [
      ['What is Cryptocurrency?', '/bitcoin-breakdown'],
      ['What is a Crypto wallet?', '/bitcoin-breakdown'],
      ['How do Crypto transactions work?', '/bitcoin-breakdown'],
    ],
  },
  {
    id: 'how-to-buy-crypto',
    title: 'How to buy Crypto',
    count: 5,
    icon: 'casino_bonus.svg',
    href: '/help-center/how-to-buy-crypto',
    articles: [
      ['Bitflyer Exchange', '/bitcoin-breakdown'],
      ['Buy Cryptocurrency without leaving Bitcasino', '/bitcoin-breakdown'],
      ['Coinbase Exchange', '/bitcoin-breakdown'],
    ],
  },
  {
    id: 'help-loyalty',
    title: 'Loyalty Club',
    count: 8,
    icon: 'hustle_to_top.svg',
    href: '/help-center/help-loyalty',
    articles: [
      ['How does the Loyalty Club work?', '/help-center/help-loyalty'],
      ['Does my Loyalty Level expire?', '/help-center/help-loyalty'],
      ['What rewards can I get?', '/help-center/help-loyalty'],
    ],
  },
  {
    id: 'help-terms-and-conditions',
    title: 'Bitcasino Information',
    count: 11,
    icon: 'price_boost.svg',
    href: '/help-center/terms-and-conditions',
    articles: [
      ['Dispute Resolution', '/help-center/dispute-resolution'],
      ['General Terms & Conditions', '/help-center/terms-and-conditions'],
      ['Bitcasino AML policy', '/help-center/aml'],
    ],
  },
];

function CategoryCard({ category }) {
  const articles = findHelpCategory(category.id)?.articles ?? [];
  return (
    <article
      data-testid={category.id}
      className="grid min-h-[276px] grid-rows-[80px_min-content_24px_96px] bg-gohan px-8 pb-3 pt-4 transition-colors hover:bg-goku"
    >
      <Link to={category.href} className="-ml-4 block h-20 w-20" aria-label={category.title}>
        <img alt="" width="80" height="80" src={`${IMAGE_ROOT}/${category.icon}?auto=compress,format&w=80&h=80&fit=max&q=50`} />
      </Link>
      <h2 className="text-2xl font-bold leading-8 text-bulma">
        <Link to={category.href} className="hover:text-piccolo">{category.title}</Link>
      </h2>
      <span className="text-[10px] uppercase leading-4 tracking-[0.5px] text-trunks">{category.count} articles</span>
      <div className="grid content-start gap-1 overflow-hidden">
        {articles.slice(0, 3).map((article) => (
          <Link key={article.slug} to={`/help-center/${category.id}/${article.slug}`} className="truncate text-sm leading-5 text-bulma hover:text-piccolo">{article.title}</Link>
        ))}
      </div>
    </article>
  );
}

export function HelpCenter() {
  return (
    <div className="w-full max-w-[99rem] overflow-x-clip">
      <div className="grid gap-4">
        <header className="grid gap-1">
          <span className="text-[10px] uppercase leading-4 tracking-[0.5px] text-trunks">Help Centre</span>
          <h1 className="font-primary text-2xl font-normal leading-8 text-bulma">Hello, how can we help?</h1>
        </header>

        <section aria-label="Help Centre categories" className="grid grid-cols-1 gap-4 pb-6 md:grid-cols-3">
          {CATEGORIES.map((category) => <CategoryCard key={category.id} category={category} />)}
        </section>

        <section className="grid max-w-[596px] gap-4">
          <h2 className="text-2xl font-bold text-bulma">Other ways to get help</h2>
          <a href="mailto:hello@bitcasino.io" className="flex items-center gap-4 bg-gohan px-6 py-4 text-bulma transition-colors hover:bg-beerus">
            <span aria-hidden="true" className="text-4xl leading-none">@</span>
            <span><strong className="block text-xl">Email us</strong><span className="text-sm text-trunks">hello@bitcasino.io</span></span>
          </a>
        </section>

        <nav aria-label="Footer breadcrumb" className="flex flex-wrap items-center gap-1 pb-4 text-sm text-trunks">
          <Link to="/" className="hover:text-piccolo">Bitcasino</Link>
          <span aria-hidden="true">›</span>
          <span>Help centre</span>
        </nav>
      </div>
    </div>
  );
}
