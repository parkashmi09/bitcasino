import { Link, useParams } from 'react-router-dom';
import { HelpCategoriesSidebar } from '../components/sections/HelpCategoriesSidebar';

const ARTICLES = [
  {
    slug: 'are-the-games-provably-fair--',
    title: 'Learn about Bitcasino Originals provably fair games',
    href: '/help-center/provably-fair',
    paragraphs: [
      'Provably fair is an approach used in online gaming that allows every result to be independently verified as genuinely random.',
      'It provides a cryptographic guarantee that game outcomes cannot be altered after a bet is placed. By combining player-provided data, server-generated data and publicly verifiable cryptographic commitments, anyone can independently reproduce and verify the outcome of a round.',
    ],
  },
  {
    slug: 'how-many-games-are-there-in-bitcasino-',
    title: 'How many games are there in Bitcasino?',
    paragraphs: [
      'We offer more than 10,000 different games from the industry\'s leading developers. From popular slots and video bingo to table games and live dealer games, take your time to browse and find your favourite games here at Bitcasino.',
    ],
  },
  {
    slug: 'how-to-buy-crypto-using-p2p-on-binance',
    title: 'How to buy crypto using P2P on Binance in Africa?',
    paragraphs: [
      'Binance P2P lets you buy cryptocurrency directly from another user using a local payment method supported in your country.',
      'Choose a verified seller, review the payment terms, complete the transfer, and release the crypto to your wallet once the order is confirmed. Always check the seller profile and transaction details before paying.',
    ],
  },
  {
    slug: 'how-to-register',
    title: 'Registering at Bitcasino',
    paragraphs: [
      'Select Register and complete the sign-up form with your email address and a secure password.',
      'After confirming your details, you can sign in and explore the games available in your region.',
    ],
  },
  {
    slug: 'can-i-access-all-the-games-in-bitcasino--',
    title: 'Can I access all the games in Bitcasino.io?',
    paragraphs: [
      'Game availability depends on your location, local regulations, and the payment or currency options available to you.',
      'You will see the games that are available for your account and jurisdiction in the lobby.',
    ],
  },
  {
    slug: 'the-game-is-stuck-what-do-i-do-',
    title: 'The game is stuck, what do I do?',
    paragraphs: [
      'First, refresh the game and check that your connection is stable. Your round history will show the result of any completed game round.',
      'If the issue continues, contact support with the game name, approximate time, and any round or transaction reference you have.',
    ],
  },
  {
    slug: 'how-do-i-make-a-deposit-',
    title: 'How do I make a deposit?',
    paragraphs: [
      'Open your Wallet and choose Deposit. Select a supported currency and payment method, then follow the instructions shown on screen.',
      'Only send funds to the address and network displayed for the current deposit request.',
    ],
  },
  {
    slug: 'how-do-i-make-a-withdrawal-',
    title: 'How do I make a withdrawal?',
    paragraphs: [
      'Open your Wallet, choose Withdraw, and select the currency and destination address you want to use.',
      'Review the network, amount, and fee carefully before confirming the request.',
    ],
  },
  {
    slug: 'is-bitcasino-licensed',
    title: 'Is Bitcasino licensed?',
    paragraphs: [
      'Bitcasino.io is operated by Moon Technologies B.V. and the casino games are provided under the gaming licence described on our license page.',
    ],
    href: '/help-center/our-license',
  },
  {
    slug: 'am-i-eligible-to-register-',
    title: 'Am I eligible to register?',
    paragraphs: [
      'You must be at least 18 years old and legally permitted to use online gaming services in your jurisdiction.',
      'Some countries and regions are restricted. Eligibility is checked during registration and verification.',
    ],
  },
  {
    slug: 'kyc-faq',
    title: 'Bitcasino verification (KYC) FAQ',
    paragraphs: [
      'Know Your Customer checks help us verify your identity and keep the platform secure.',
      'If verification is requested, submit clear and valid documents through the secure verification flow and make sure the details match your account.',
    ],
  },
];

function Breadcrumbs({ article }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-bulma">
      <Link to="/" className="hover:text-piccolo">Bitcasino</Link>
      <span aria-hidden="true">›</span>
      <Link to="/help-center" className="hover:text-piccolo">Help centre</Link>
      <span aria-hidden="true">›</span>
      {article ? <Link to="/help-center/help-getting-started" className="hover:text-piccolo">Getting Started</Link> : <span>Getting Started</span>}
      {article && <><span aria-hidden="true">›</span><span>{article.title}</span></>}
    </nav>
  );
}

function SupportFooter() {
  return (
    <section className="mt-10 max-w-[596px] border-t border-beerus pt-8">
      <h2 className="text-2xl font-bold text-bulma">Other ways to get help</h2>
      <a href="mailto:hello@bitcasino.io" className="mt-4 flex items-center gap-4 bg-gohan px-6 py-4 text-bulma hover:bg-beerus">
        <span aria-hidden="true" className="text-4xl leading-none">@</span>
        <span><strong className="block text-xl">Email us</strong><span className="text-sm text-trunks">hello@bitcasino.io</span></span>
      </a>
    </section>
  );
}

function ArticlePage({ article }) {
  return (
    <div className="w-full max-w-[99rem] overflow-x-clip md:mx-auto">
      <Breadcrumbs article={article} />
      <div className="mt-8 grid gap-10 md:grid-cols-[minmax(0,1fr)_280px] md:gap-8 lg:grid-cols-[minmax(0,800px)_280px] lg:justify-between">
        <article className="min-w-0 max-w-[800px] text-[15px] leading-6 text-bulma md:text-base md:leading-7">
          <div className="mb-8">
            <p className="mb-2 text-[10px] uppercase leading-4 tracking-[0.5px] text-trunks">Getting Started</p>
            <h1 className="font-primary text-2xl font-bold leading-8 text-bulma">{article.title}</h1>
          </div>
          {article.paragraphs.map((paragraph) => <p key={paragraph} className="mt-4 first:mt-0">{paragraph}</p>)}
          {article.href && <p className="mt-4"><Link to={article.href} className="text-piccolo underline hover:no-underline">Read more</Link></p>}
        </article>
        <HelpCategoriesSidebar />
      </div>
      <SupportFooter />
    </div>
  );
}

export function HelpGettingStarted() {
  const { articleSlug } = useParams();
  const article = ARTICLES.find(({ slug }) => slug === articleSlug);

  if (articleSlug && article) return <ArticlePage article={article} />;

  return (
    <div className="w-full max-w-[99rem] overflow-x-clip">
      <div className="grid gap-6">
        <Breadcrumbs />
        <header className="grid gap-1">
          <span className="text-[10px] uppercase leading-4 tracking-[0.5px] text-trunks">Help Centre</span>
          <h1 className="font-primary text-2xl font-normal leading-8 text-bulma">Getting Started</h1>
        </header>
        <section aria-labelledby="getting-started-heading" className="grid grid-cols-1 gap-4 pb-6 md:grid-cols-3">
          <h2 id="getting-started-heading" className="sr-only">Getting Started support articles</h2>
          {ARTICLES.map(({ title, slug }) => (
            <div key={slug} className="grid self-start gap-1">
              <span className="text-[10px] uppercase leading-4 tracking-[0.5px] text-trunks">Support</span>
              <Link to={`/help-center/help-getting-started/${slug}`} className="text-xl leading-8 text-bulma transition-colors hover:text-piccolo">{title}</Link>
            </div>
          ))}
        </section>
        <SupportFooter />
        <nav aria-label="Footer breadcrumb" className="flex flex-wrap items-center gap-1 pb-4 text-sm text-trunks">
          <Link to="/" className="hover:text-piccolo">Bitcasino</Link>
          <span aria-hidden="true">›</span>
          <Link to="/help-center" className="hover:text-piccolo">Help centre</Link>
          <span aria-hidden="true">›</span>
          <span>Getting Started</span>
        </nav>
      </div>
    </div>
  );
}
