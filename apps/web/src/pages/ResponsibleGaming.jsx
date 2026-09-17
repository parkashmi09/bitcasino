import { Link } from 'react-router-dom';

const CATEGORIES = [
  ['Getting Started', '/help-center'],
  ['Your Account', '/help-center'],
  ['Your Transactions', '/help-center'],
  ['Your rewards', '/help-center'],
  ['Payment Options', '/help-center'],
  ['About Crypto', '/help-center'],
  ['How to buy Crypto', '/help-center'],
  ['Loyalty Club', '/loyalty'],
  ['Bitcasino Information', '/help-center/terms-and-conditions'],
];

const RELATED_ARTICLES = [
  ['What is the Vault?', '/help-center/your-account/what-is-the-vault'],
  ['How to use Metamask?', '/help-center/your-account/how-to-use-metamask'],
  ['I cannot access my Account', '/help-center/your-account/i-cannot-access-my-account'],
];

function Breadcrumbs() {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-bulma">
      <Link to="/" className="hover:text-piccolo">Bitcasino</Link>
      <span aria-hidden="true">›</span>
      <Link to="/help-center" className="hover:text-piccolo">Help centre</Link>
      <span aria-hidden="true">›</span>
      <Link to="/help-center" className="hover:text-piccolo">Your Account</Link>
      <span aria-hidden="true">›</span>
      <span>Responsible Gaming</span>
    </nav>
  );
}

function Categories() {
  return (
    <aside className="hidden min-w-72 self-start md:block md:ps-8 lg:min-w-[280px] lg:ps-4">
      <h2 className="mb-4 text-2xl font-normal leading-8 text-bulma">Categories</h2>
      <div className="divide-y divide-beerus border-t border-beerus">
        {CATEGORIES.map(([label, to]) => (
          <Link key={label} to={to} className="block py-4 text-base text-bulma hover:text-piccolo">{label}</Link>
        ))}
      </div>
    </aside>
  );
}

function SupportLink({ href, children }) {
  return <a href={href} target="_blank" rel="noreferrer" className="underline hover:text-piccolo">{children}</a>;
}

function Article() {
  return (
    <article className="min-w-0 max-w-[800px] text-[15px] leading-6 text-bulma md:text-base md:leading-7">
      <div className="mb-8">
        <p className="mb-2 text-[10px] uppercase leading-4 tracking-[0.5px] text-trunks">Your Account</p>
        <h1 className="font-primary text-2xl font-bold leading-8 text-bulma">Responsible Gaming</h1>
      </div>

      <p>At Bitcasino.io, alongside our sister platforms Sportsbet.io and Livecasino.io, we offer a platform and services that enable our clients to enjoy gaming and betting. We aim to provide you with a safe, secure, regulated environment which will give you a pleasant and rewarding experience. We encourage our clients to use our services responsibly and in a reasonable manner.</p>
      <p className="mt-4">Gambling of all varieties has been a popular form of entertainment for many years. Here at Bitcasino.io, Sportsbet.io and Livecasino.io, we encourage it to be exactly that: fun. We also encourage our customers not to allow gambling to affect their usual daily routine or time spent with family and friends. Make sure that money spent is set aside for leisure and not for other purposes. It is very important not to rely on paying for life's necessities with possible gambling gains, as this is not guaranteed.</p>
      <p className="mt-4">While most customers gamble in this manner, we understand that a small minority can develop problems with their gambling.</p>
      <p className="mt-4">At Bitcasino.io, Sportsbet.io and Livecasino.io, our customers' wellbeing is of utmost importance. We take our role within responsible gambling very seriously and recommend that you:</p>

      <ul className="mt-4 list-disc space-y-2 ps-7 marker:text-piccolo md:ps-8">
        <li>Treat betting and gaming as entertainment and only use money set aside for entertainment.</li>
        <li>Do not bet or wager amounts larger than you are comfortable with.</li>
        <li>Do not bet or wager with money you cannot afford to lose.</li>
        <li>Do not chase your losses.</li>
        <li>Do not let betting or gaming take time you would usually spend on other activities.</li>
      </ul>

      <p className="mt-4">If you have concerns about your gambling habits and feel that you cannot follow these recommendations, we urge you to seek advice from accredited organisations that can offer support and advice, such as:</p>
      <ul className="mt-4 list-disc space-y-2 ps-7 marker:text-piccolo md:ps-8">
        <li><SupportLink href="http://www.gamcare.org.uk/">GamCare</SupportLink></li>
        <li><SupportLink href="https://keepitfun.rank.com/">Keep It Fun</SupportLink></li>
        <li><SupportLink href="https://www.gamblingtherapy.org/">Gambling Therapy</SupportLink></li>
      </ul>

      <p className="mt-4">You can also contact our friendly Bitcasino.io support agents at <a href="mailto:safergaming@bitcasino.io" className="underline hover:text-piccolo">safergaming@bitcasino.io</a> if you would like to discuss our self-exclusion process. Sometimes a short break can be useful in gathering your thoughts and stopping you from making a rash wagering decision.</p>
      <p className="mt-4">On request, we will place your account on a minimum 24-hour cooling-off period. This will be followed by one of our support agents informing you of the voluntary 1-week, 1-month, 3-month, 6-month or permanent self-exclusions available.</p>
      <p className="mt-4">Please note that accounts closed under our self-exclusion Policy cannot be reversed or reopened for any reason. Once your self-exclusion has expired, we will email you to let you know your account is active again. Permanent self-exclusion will remain in place indefinitely.</p>

      <h2 className="mb-4 mt-10 font-primary text-xl font-bold leading-7 text-bulma">Underage</h2>
      <p>You must be over 18 years of age, or the legal minimum age for gambling in the jurisdiction where you reside under the laws applicable to you, to gamble with Bitcasino.io, Sportsbet.io or Livecasino.io.</p>
      <p className="mt-4">If you have minors living in your household, we recommend reviewing parental-control software that may help control and restrict content accessible on your devices.</p>
      <ul className="mt-4 list-disc space-y-2 ps-7 marker:text-piccolo md:ps-8">
        <li><SupportLink href="https://www.netnanny.com/">https://www.netnanny.com/</SupportLink></li>
      </ul>
      <p className="mt-4">We encourage you to take a short self-assessment questionnaire to help you understand your gaming habits and ensure that playing remains enjoyable and under control. Questionnaires can be found on <SupportLink href="https://gamblersanonymous.org/20-questions/">Gamblers Anonymous</SupportLink> or <SupportLink href="https://gamblingtherapy.org/information/do-i-have-a-gambling-problem/">Gambling Therapy</SupportLink>.</p>
    </article>
  );
}

export function ResponsibleGaming() {
  return (
    <div className="w-full max-w-[99rem] overflow-x-clip md:mx-auto">
      <Breadcrumbs />
      <div className="mt-8 grid gap-10 md:grid-cols-[minmax(0,1fr)_280px] md:gap-8 lg:grid-cols-[minmax(0,800px)_280px] lg:justify-between">
        <Article />
        <Categories />
      </div>
      <section className="mt-14 border-t border-beerus pt-8">
        <h2 className="mb-5 text-2xl font-bold text-bulma">Related articles</h2>
        <div className="grid gap-6 md:grid-cols-3">
          {RELATED_ARTICLES.map(([label, to]) => (
            <Link key={label} to={to} className="text-xl text-bulma hover:text-piccolo">
              <span className="mb-1 block text-[10px] uppercase leading-4 tracking-[0.5px] text-trunks">Your Account</span>
              {label}
            </Link>
          ))}
        </div>
      </section>
      <section className="mt-10 max-w-[596px] border-t border-beerus pt-8">
        <h2 className="text-2xl font-bold text-bulma">Other ways to get help</h2>
        <a href="mailto:hello@bitcasino.io" className="mt-4 flex items-center gap-4 bg-gohan px-6 py-4 text-bulma hover:bg-beerus">
          <span aria-hidden="true" className="text-4xl leading-none">@</span>
          <span><strong className="block text-xl">Email us</strong><span className="text-sm text-trunks">hello@bitcasino.io</span></span>
        </a>
      </section>
    </div>
  );
}