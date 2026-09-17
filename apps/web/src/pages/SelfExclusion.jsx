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
  ['Dispute Resolution', '/help-center/dispute-resolution'],
  ['General Terms & Conditions', '/help-center/terms-and-conditions'],
  ['Bitcasino AML policy', '/help-center/aml'],
];

const obligations = [
  'You should not attempt to deposit or place any wager on any Bitcasino.io, Sportsbet.io or Livecasino.io account that you have requested to be excluded from during your selected self-exclusion.',
  'You should not attempt or proceed to open any new Bitcasino.io, Sportsbet.io or Livecasino.io accounts during your self-exclusion timeframe, or forever if permanent self-exclusion has been selected.',
  'If you succeed in opening a new account during a self-exclusion timeframe, we will endeavour to close it at our earliest detection.',
  'Bitcasino.io, Sportsbet.io and Livecasino.io are responsible for taking reasonable steps to prevent you from gambling on our products. It is also your responsibility to refrain from breaching these agreed terms.',
  'We may not be able to check your status against a national self-exclusion registry. It is your responsibility to ensure you are not self-excluded and are eligible to participate in wagering.',
  'This is a voluntary request made by you. If you breach this agreement, the platforms and their employees are not liable for losses you may suffer. Losses acquired during your self-exclusion period will not be refunded.',
];

function Breadcrumbs() {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-bulma">
      <Link to="/" className="hover:text-piccolo">Bitcasino</Link>
      <span aria-hidden="true">›</span>
      <Link to="/help-center" className="hover:text-piccolo">Help centre</Link>
      <span aria-hidden="true">›</span>
      <Link to="/help-center/terms-and-conditions" className="hover:text-piccolo">Bitcasino Information</Link>
      <span aria-hidden="true">›</span>
      <span>Bitcasino Self-Exclusion Terms and Conditions</span>
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

function Article() {
  return (
    <article className="min-w-0 max-w-[800px] text-[15px] leading-6 text-bulma md:text-base md:leading-7">
      <div className="mb-8">
        <p className="mb-2 text-[10px] uppercase leading-4 tracking-[0.5px] text-trunks">Bitcasino Information</p>
        <h1 className="font-primary text-2xl font-bold leading-8 text-bulma">Bitcasino Self-Exclusion Terms and Conditions</h1>
      </div>

      <p>By requesting to partake in the Bitcasino.io self-exclusion process, you agree to the following terms and conditions.</p>
      <p className="mt-4">Self-exclusion requests must be emailed from the account's registered email address to our Safer Gaming Team at <a href="mailto:safergaming@bitcasino.io" className="underline hover:text-piccolo">safergaming@bitcasino.io</a>.</p>
      <p className="mt-4">Requests made via chat will not be actioned. However, a customer support agent will direct you to our customer support email service.</p>
      <p className="mt-4">All Bitcasino.io self-exclusion requests made after 20 January 2020 also apply to our sister platforms Sportsbet.io and Livecasino.io. Existing accounts on those platforms will be added to your applied Bitcasino.io self-exclusion. You will not be permitted to open future Bitcasino.io, Sportsbet.io or Livecasino.io accounts during your active self-exclusion timeframe or permanently if permanent self-exclusion is requested.</p>
      <p className="mt-4">Upon receipt of a self-exclusion request by email, the registered account and any associated accounts, as defined by Bitcasino.io, will enter the first stage: a 24-hour cooling-off period that disables further activity. Bitcasino.io's internal checks will detect and determine associated accounts at the earliest opportunity.</p>
      <p className="mt-4">Once the first 24-hour cooling-off period has passed, while your account and associated accounts remain closed, you will be informed by email of the available 1-week, 1-month, 3-month, 6-month and permanent self-exclusion timeframes. There will be no variations to these options.</p>
      <p className="mt-4">To proceed, we require an email response. If we do not receive a response within a further 24 hours, and no timeframe was mentioned in your initial request, your account may be reopened and confirmed by email.</p>
      <p className="mt-4">After reviewing the options, if you decide to proceed with permanent self-exclusion, please inform us in your response.</p>
      <p className="mt-4">We may occasionally implement a self-exclusion timeframe without a request if we believe it is beneficial or necessary for the customer's wellbeing. This will be communicated by email, and these Self-Exclusion Terms and Conditions will apply.</p>
      <p className="mt-4">When you request, or we deem it necessary to add, a Bitcasino.io, Sportsbet.io or Livecasino.io self-exclusion, any remaining account balance will be returned to you manually unless you are undergoing a simultaneous security check. You are not permitted to leave a balance in your account during a self-exclusion timeframe.</p>
      <p className="mt-4">Bitcasino.io will review any active bets within a Sportsbet.io account affected by self-exclusion at our discretion.</p>
      <p className="mt-4">Once self-exclusion is applied to your account and associated accounts, it will remain in place until the requested timeframe has finished. It will not be removed, decreased or revoked for any reason. Permanent self-exclusions remain in place forever.</p>
      <p className="mt-4">Bitcasino.io, Sportsbet.io and Livecasino.io will use all reasonable endeavours to comply with our Responsible Gambling Self-Exclusion Policy. However, you accept that we will not be held responsible or liable if you attempt to open new accounts or succeed in activity on any of our websites. We are also not liable if you continue to deposit and wager using additional accounts that were not disclosed. Future wagers, reward funds and promotion entries during a requested self-exclusion timeframe will be forfeited, with no return of stakes or payment of winnings and no reinstatement upon completion.</p>

      <p className="mt-4">You acknowledge that:</p>
      <ul className="mt-4 list-disc space-y-3 ps-7 marker:text-piccolo md:ps-8">
        {obligations.map((obligation) => <li key={obligation}>{obligation}</li>)}
      </ul>

      <p className="mt-4">This is a voluntary agreement. If you breach these terms, all wagering will be dealt with at Bitcasino.io's discretion. If we suspect, or an investigation shows, that you actively attempted to disguise the source of your account or accounts and affected our ability to identify and block them promptly, this will also be dealt with at our discretion.</p>
      <p className="mt-4">Upon completion of self-exclusion, a customer support agent will contact your registered email address to inform you of account reactivation.</p>
    </article>
  );
}

export function SelfExclusion() {
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
              <span className="mb-1 block text-[10px] uppercase leading-4 tracking-[0.5px] text-trunks">Bitcasino Information</span>
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