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
  ['Bitcasino AML policy', '/help-center/aml'],
  ['Bitcasino Reward Terms & Conditions', '/help-center/reward-terms'],
];

const definitions = [
  ['Bitcasino.io', "is referred to as 'we' or 'us' or 'Company'."],
  ['Player', "is referred to as 'you' or 'Player' or 'Member' or 'Customer(s)' or 'Account Holder'."],
  ['Game(s)', 'means Casino and other RNG (Random Number Generator) games, which may become available from time to time on the website.'],
  ['Website', 'means Bitcasino.io through desktop, mobile or other platforms utilised by the Player.'],
  ['Member Account', 'User account required to access and use the Website.'],
  ['Customer Support', 'Assistance and support services provided by the Company to its Customers.'],
  ['Event(s)', 'Refers to a betting event or competition or game in a sport where Customers can place wagers for bets on the outcome.'],
  ['Cryptocurrency, Cryptocurrencies and Crypto', "should further be read as 'bitcoin, altcoins, and/or (where applicable) other supported Cryptocurrencies'."],
  ['BTC', 'Bitcoin (1 BTC = 1,000 mBTC (millibitcoins) = 1,000,000 uBTC (microbitcoins/bits)).'],
  ['Fiat money', 'A currency issued by a government or Central Banking Authority that is not backed by a physical commodity, such as gold or silver (e.g. USD, BRL, JPY, CNY).'],
  ['Restricted Jurisdiction(s)', 'specific countries or territories restricted by our gaming license. Users located in or from these regions are prohibited from registering and playing on the Website. To play from Japan is prohibited.'],
];

const sections = [
  ['1. General', [
    'These terms and conditions ("Terms and Conditions") apply to the usage of Games accessible through Website.',
    'Bitcasino.io is owned and operated by Moon Technologies B.V. (Schout Bij Nacht Doormanweg 40, P.O. Box 4745, Curaçao).',
    'These Terms and Conditions come into force as soon as you complete the registration process, including checking the box accepting these Terms and Conditions and successfully creating an account.',
    'You must read these Terms and Conditions carefully in their entirety before creating an account. If you do not agree with any provision, you must not create an account or continue to use the Website.',
    'We are entitled to amend these Terms and Conditions at any time. Material changes will be brought to your attention by email or by placing a notice on the Website. Continued use after an amendment is acceptance of the amended Terms and Conditions.',
    'These Terms and Conditions may be published in several languages. The English version is the only legal basis of the relationship between you and us and shall prevail in case of discrepancy.',
  ]],
  ['2. Binding Declarations', [
    'By agreeing to these Terms and Conditions, you also agree to the Website Rules and Privacy Policy incorporated by reference. You represent and warrant that you are over 18, have capacity to enter this agreement, and participate personally for recreational and entertainment purposes only.',
    'You place bets on your own behalf, provide true and complete information, and are responsible for any applicable taxes, fees and charges on winnings.',
    'You understand that using our services carries a risk of losing deposited money and that Cryptocurrency values can change dramatically. Crypto is treated on the Website as virtual funds with no intrinsic value.',
    'You will not use our services from a Restricted Jurisdiction, will only use funds lawfully belonging to you, and may have only one account with us.',
    'The software, graphics, Website and user interface are owned by the Company or its associates and may only be used for personal, recreational purposes in accordance with these rules and applicable regulations.',
    'We reserve the right to detect and prevent prohibited techniques, including fraudulent transactions, automated registration or gameplay, screen capture techniques, geo-location and IP masking, transaction analysis and blockchain analysis.',
  ]],
  ['3. Your Member Account', [
    'To place bets on our Website, you must personally register a Member Account. Persons in a Restricted Jurisdiction are not allowed to register.',
    'You are responsible for determining whether accessing and using our Website is compliant with the laws applicable to you. If you access the Website from a Restricted Jurisdiction, your account may be closed, winnings and rewards may be confiscated, and funds may be reclaimed.',
    'If you attempt to open more than one Member Account, we may block, suspend or close your account and freeze funds. If you discover that you have more than one account, notify us immediately.',
    'You must enter valid, true, complete and correct registration information, including a valid email address. We may carry out KYC verification and block or close an account if information is false or misleading.',
    'You are responsible for keeping your username and password secure and must not disclose them. After changing your password, withdrawals may be unavailable for 48 hours for security reasons.',
    'We may conduct random Account Health Checks to prevent financial crime, fraud and money laundering. Account access, gameplay, deposits and withdrawals may be temporarily restricted during a review.',
    'A registering player must explicitly confirm that they are registering to play on their own behalf and solely hold beneficial ownership of their gaming account.',
  ]],
  ['4. Security', [
    'You must keep your password confidential and are responsible for misuse of your password. Losses caused by a third party using your account will not be refunded.',
    'Inform us immediately by email if you believe your account information is being misused. We recommend Two Step Verification and disabling automatic password memory in your browser.',
  ]],
  ['5. Deposits', [
    'You may participate in a Game only if you have sufficient funds in your Member Account.',
    'Deposits may be made in Cryptocurrencies or Fiat. Minimum deposit amounts are listed in the Help Centre. Deposits below the minimum may not be credited or returned.',
    'Deposits can only be made with your own funds from wallets or bank accounts under your control. Sending the wrong cryptocurrency to the wrong network address or wallet may cause an irrecoverable loss for which we are not responsible.',
    'We may use identity and payment-instrument verification procedures when processing deposits. Some payment methods and providers may charge additional fees.',
  ]],
  ['6. Withdrawals', [
    'Crypto withdrawals are made to the Cryptocurrency wallet address entered in a valid withdrawal request. You must verify your registered email and there must be at least three blockchain confirmations of a deposit before a withdrawal can be requested.',
    'Fiat withdrawals are made to your personal Fiat account and may take up to three working days after approval, depending on the payment provider. Minimum withdrawal amounts are listed in the Help Centre.',
    'Mistakenly credited winnings remain the property of the Website and may be deducted. You must notify us immediately of any incorrect credit.',
    'We may require wagering of at least the deposit amount before accepting a withdrawal, and may apply a five-times wagering requirement if we suspect the service is being used as a mixer.',
    'We may delay or block withdrawals pending KYC, anti-money-laundering checks or requested identification and address documents. Withdrawals exceeding EUR 2,500, or equivalent Cryptocurrency value, may require additional verification.',
    'Promotions may carry withdrawal restrictions. Withdrawing before wagering requirements are fulfilled may result in the reward and associated winnings being deducted. Transaction, payment-provider and currency-conversion fees may also apply.',
    'For a large withdrawal request, we may process no more than 1 Million USDT, or equivalent, per week until the full amount is settled.',
  ]],
  ['7. Funds', [
    'Customers cannot move or convert funds between wallets and currencies. We do not extend credit, pay interest on balances, or operate as a financial institution.',
    'If an error or duplicate withdrawal overdraws your account, you agree to reimburse the Website. Double-spend activity may cause bets and winnings to be voided and the account to be closed.',
  ]],
  ['8. Rewards and promotions', [
    'We may cancel a promotion or reward immediately if it is incorrectly set up, abused, or unused within 72 hours, unless separate promotion terms state otherwise.',
    'Deposit rewards may prevent withdrawal of the original deposit until the stated requirements are met. We may reclaim reward elements, void bets or free spins, and charge administration costs where an offer is breached or abused.',
    'Offers are intended for recreational players. Rewards may be claimed once per person, account, family, household, address, email address, IP address or shared-device environment.',
    'Separate promotion terms apply in addition to these Terms and Conditions and prevail in case of conflict. Some Games have maximum win amounts displayed in the Game information.',
    'For reward money with wagering requirements, the reward and its winnings must be turned over the specified number of times. Wagering contribution is: Slots 100%; Live Game Shows 20%; Live-dealer games 10%; Table Games and RNG-based games 10%; Bitcasino Originals 10%.',
    'Rewards and free spins do not qualify for jackpot rewards where prohibited by the casino software provider. Only real-money rounds qualify.',
  ]],
  ['9. Closing of Member Accounts', [
    'You may close your Member Account at any time by contacting Customer Support in writing by email. If closure relates to gambling addiction or problem gambling, state this in your request.',
    'We may refuse or close an account at our discretion. In the absence of suspected fraud, money laundering or unlawful conduct, we will transfer or return the account balance using an appropriate payment method before closure.',
  ]],
  ['10. Support services', [
    'Support may be provided through multiple moderated communication channels. We may review and keep records of statements made through them.',
    'We may restrict support or terminate an account for insulting, abusive, defamatory, harassing, sexually explicit, hateful or grossly offensive material; advertising other entities; repetitive false statements; malicious claims; collusion; or unlawful conduct.',
  ]],
  ['11. General Betting Rules (GBR)', [
    'A bet can only be placed by a registered Account Holder over the internet and only when sufficient funds are available.',
    'An accepted bet cannot be amended, withdrawn or cancelled by you. It is governed by the Terms and Conditions available when accepted.',
    'The Website manages account funds and winnings. These amounts are final in the absence of manifest error. You are fully responsible for bets placed, and winnings are paid after the final result is confirmed.',
    'We may hold or void bets and winnings during investigations into criminal activity, manipulation, technological failure, or irregular accounts. If a bet is correctly received on our servers despite a communication break, it remains valid and accepted.',
  ]],
  ['12. Miscarried and aborted Games', [
    'The Company is not liable for downtime, server disruption, lagging, political or technical disturbance. In the event of a casino system malfunction, all wagers are void.',
  ]],
  ['13. Limitation of liability', [
    'You access the Website and participate in Games at your own risk. The Website and Games are provided without warranty and may not be error-free, fit for purpose or continuously accessible.',
    'Except where expressly stated, we are not liable for losses, costs, expenses or damages arising from your use of the Website or participation in Games. You agree to indemnify and hold harmless the Company, its directors, employees, partners and service providers.',
    'Intentional exploitation of a known or uncovered malfunction or glitch is forbidden. We may confiscate winnings or dismiss claims connected with such conduct.',
  ]],
  ['14. Fairness and RNG Testing Methods', [
    'The Website operates under a Curaçao gaming license issued by the CGA. Products are supplied by companies with approved certification status and undergo internal and External Compliance Testing covering functionality, display, transactions, rules and mathematics.',
    'Games offer unpredictable play and possibilities of large wins and losses. The theoretical Return to Player (RTP) value for each Game is available in its information section.',
  ]],
  ['15. Privacy Policy', [
    'We may collect and use personal data to provide access to the Website and Games. We protect personal information in accordance with applicable law and best business practices.',
    'Employees, business partners, suppliers and service providers may access personal data where necessary to provide the service or comply with law. You may access personal data held about you.',
    'Transaction-related data is retained for five years where required by governing law. We use cookies to improve the Website; disabling them may restrict or prevent use of the service.',
  ]],
  ['16. Responsible Gaming', [
    'Gambling carries a natural risk of financial loss. We offer practical tools including Self-Exclusion and self-limiting features, supported by our Responsible Gaming Policy.',
    'Self-excluded player records are retained in a dedicated register for a minimum of seven years from the end of the exclusion period.',
    'Participation is prohibited for persons under 18 and vulnerable persons, including those subject to self-exclusion or gambling restrictions. We may suspend accounts and void bets where this is identified.',
    'A vulnerable person may be underage, self-excluded, subject to restrictions, showing signs of problem gambling, lacking capacity to gamble responsibly, or otherwise at increased risk of gambling-related harm.',
    'Self-assessment questionnaires are available from Gamblers Anonymous and Gambling Therapy.',
  ]],
  ['17. Assignment', ['You may not assign your obligations, rights or obligations under this Agreement to another person or entity.']],
  ['18. Entire Agreement', ['These Terms and Conditions constitute the entire agreement between you and us regarding the Website and supersede prior communications and proposals, except in cases of fraud.']],
  ['19. Severability', ['If any provision is illegal or unenforceable, it shall be severed and all other provisions shall remain in force.']],
  ['20. Cancellations, Suspensions and Closure', [
    'We may suspend or terminate an account, cancel outstanding bets or confiscate funds if we suspect money laundering, unlawful or fraudulent activity; multiple or connected accounts; collusion; breach of these Terms; use of devices, robots or software to interfere with services; unfair advantage; third-party use; or intentional exploitation of errors and vulnerabilities.',
    'The Website is the final decision-maker as to whether rules have been violated. We may void outstanding bets where there is a technological failure or a breach of these Terms and Conditions.',
  ]],
  ['21. Force Majeure', ['Failure or delay caused by events beyond the reasonable control of the Website, including natural disasters, war, epidemics, riots, terrorism, utility failure, strikes or Internet and telecommunications disruption, is not a breach.']],
  ['22. Breaches, Penalties and Termination', ['If you breach these Terms, or we reasonably suspect a breach, we may refuse to open, suspend or close your Member Account, withhold winnings and apply funds to damages due by you.']],
  ['23. Applicable law and jurisdiction', ['These Terms and Conditions are governed by the laws of Curaçao. Contractual relationships are deemed entered into and performed in Curaçao, and disputes shall be submitted to the exclusive jurisdiction of the Curaçao courts.']],
  ['24. Complaints', [
    'For a complaint about our services, contact Customer Support by chat or email. Complaints must be submitted within six months of the related event using the designated Company template.',
    'The complaint must include your full name, address and place of residence; date of complaint; a submission in English, Dutch or Papiamentu; and a detailed description of the issue.',
    'If you are not satisfied with the resolution, you may escalate the complaint to Curaçao eGaming or another ADR provider. The CGA does not decide complaints about gambling-related transactions.',
  ]],
  ['25. Alternative Dispute Resolution', [
    'A player who is not satisfied with the resolution may escalate the complaint to a CGA-certified ADR entity. The ADR provider decision is final and binding.',
    'Our complaint policy aims to maintain transparency, fairness and player trust while operating within Curaçao eGaming licensing regulations. Complaint records are securely maintained for a minimum of five years.',
  ]],
];

function Breadcrumbs() {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-bulma">
      <Link to="/" className="hover:text-piccolo">Bitcasino</Link>
      <span aria-hidden="true">›</span>
      <Link to="/help-center" className="hover:text-piccolo">Help centre</Link>
      <span aria-hidden="true">›</span>
      <Link to="/help-center" className="hover:text-piccolo">Bitcasino Information</Link>
      <span aria-hidden="true">›</span>
      <span>General Terms &amp; Conditions</span>
    </nav>
  );
}

function Article() {
  return (
    <article className="min-w-0 max-w-[800px] text-[15px] leading-6 text-bulma md:text-base md:leading-7">
      <div className="mb-8">
        <p className="mb-2 text-[10px] uppercase leading-4 tracking-[0.5px] text-trunks">Bitcasino Information</p>
        <h1 className="font-primary text-2xl font-bold leading-8 text-bulma">General Terms &amp; Conditions</h1>
        <button type="button" onClick={() => window.print()} className="mt-4 rounded-md border border-bulma bg-transparent px-5 py-2 font-medium text-bulma hover:bg-gohan">
          Print
        </button>
        <p className="mt-3 italic">Updated: 26.06.2025</p>
      </div>

      <h2 className="mb-4 mt-10 font-primary text-xl font-bold leading-7 text-bulma">Definitions</h2>
      <ul className="mb-8 list-disc space-y-2 ps-7 marker:text-piccolo md:ps-8">
        {definitions.map(([term, description]) => (
          <li key={term}><em>{term}</em> &ndash; {description}</li>
        ))}
      </ul>

      {sections.map(([heading, paragraphs]) => (
        <section key={heading} className="scroll-mt-24">
          <h2 className="mb-4 mt-10 font-primary text-xl font-bold leading-7 text-bulma">{heading}</h2>
          {paragraphs.map((paragraph, index) => (
            <p key={`${heading}-${index}`} className="mb-4">{paragraph}</p>
          ))}
        </section>
      ))}
    </article>
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

export function TermsAndConditions() {
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