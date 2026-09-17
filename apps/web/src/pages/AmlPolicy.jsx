import { Link } from 'react-router-dom';
import { HelpCategoriesSidebar } from '../components/sections/HelpCategoriesSidebar';

const RELATED_ARTICLES = [
  ['Dispute Resolution', '/help-center/dispute-resolution'],
  ['General Terms & Conditions', '/help-center/terms-and-conditions'],
  ['Bitcasino Reward Terms & Conditions', '/help-center/reward-terms'],
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
      <span>Bitcasino AML policy</span>
    </nav>
  );
}

function Article() {
  return (
    <article className="min-w-0 max-w-[800px] text-[15px] leading-6 text-bulma md:text-base md:leading-7">
      <div className="mb-8">
        <p className="mb-2 text-[10px] uppercase leading-4 tracking-[0.5px] text-trunks">Bitcasino Information</p>
        <h1 className="font-primary text-2xl font-bold leading-8 text-bulma">Bitcasino AML policy</h1>
      </div>

      <p className="italic">Updated: 24.11.2022</p>

      <h2 className="mb-4 mt-10 text-xl font-bold leading-7 text-bulma">Policy approval</h2>
      <p>Moon Technologies B.V. (Curaçao) (the "Company" or "We") is a company registered and incorporated in Curaçao with company registration number 152185.</p>
      <p className="mt-4">Gaming License Number: 1668/JAZ</p>
      <p className="mt-4">The Company is approved to accept and transact with customers in fiat currencies, crypto currencies, or a combination of both.</p>
      <p className="mt-4">We are committed to preventing our systems from being used for money laundering, terrorist financing or other crime. This includes applying the measures described below.</p>

      <h2 className="mb-4 mt-10 text-xl font-bold leading-7 text-bulma">General provisions</h2>
      <p>We are fully committed to applying measures to prevent money laundering and combat terrorist financing. We are also committed to our social duty to prevent our systems from being used as a tool for crime.</p>
      <p className="mt-4">We endeavour to stay updated with developments in prevention measures in order to protect the organisation, its operations and its reputation.</p>
      <p className="mt-4">Our policies and procedures were built, and continue to be updated, to observe the laws relevant to our operations.</p>

      <h2 className="mb-4 mt-10 text-xl font-bold leading-7 text-bulma">Laws and regulations</h2>
      <p>The Curaçao Gaming Control Board is the designated supervisory authority for our service.</p>
      <p className="mt-4">We are required to comply with all applicable laws and regulations within the jurisdiction of Curaçao, including national ordinances covering the criminal code, identification for services, identification when rendering services, and the reporting of unusual transactions.</p>
      <p className="mt-4">As a provider of online games of chance, we must have adequate practices and procedures in place to prevent our systems from facilitating money laundering and the funding of terrorist and criminal activities.</p>

      <h2 className="mb-4 mt-10 text-xl font-bold leading-7 text-bulma">Customer due diligence</h2>
      <p>We apply appropriate customer due diligence measures required by law, including the use of identifiers.</p>
      <p className="mt-4">Due diligence checks form part of our customer registration procedures. These checks verify age, name, residential address, nationality, politically exposed person status, and sanctions status.</p>
      <p className="mt-4">If a customer's risk profile changes based on any number of red flags, we will conduct enhanced due diligence. This may include verification using personal documents, publicly held data, privileged information from other operators and sources, financial or corporate data, and third-party data providers.</p>
      <p className="mt-4">We have a duty to monitor all customer relationships in accordance with industry best practice, international recommendations, and guidelines.</p>
      <p className="mt-4">Suspicious transactions or circumstances potentially related to money laundering and terrorist financing will be reported to the relevant law-enforcement authority.</p>
      <p className="mt-4">Where due diligence checks cannot be completed, we will suspend the business relationship until the checks have been satisfactorily completed.</p>

      <h2 className="mb-4 mt-10 text-xl font-bold leading-7 text-bulma">Cryptocurrency transactions</h2>
      <p>The Company may perform additional background and security checks for customers wishing to deposit or withdraw using cryptocurrencies. In case of suspicion, the Company may suspend the customer account and request additional due-diligence documentation.</p>
      <p className="mt-4">If we cannot assure ourselves of the customer's identity or source of funding, the matter may be referred to the management board and service provider for review and a final decision.</p>
      <p className="mt-4">If the decision is to terminate the relationship, retained customer funds will be held in a seized-funds account and declared as part of any suspicious-activity report made to law enforcement.</p>

      <h2 className="mb-4 mt-10 text-xl font-bold leading-7 text-bulma">Reporting suspicions</h2>
      <p>As a Curaçao eGaming IP licensee, we are obliged to report unusual or suspicious transactions in accordance with the National Ordinance and as a registered body of the Department of the Financial Intelligence Unit (FIU).</p>
      <p className="mt-4">A customer identified as being on a sanctions list, linked to money laundering, the financing of terrorism, or other criminal activity may warrant the submission of a formal suspicious-activity report to law enforcement.</p>
    </article>
  );
}

export function AmlPolicy() {
  return (
    <div className="w-full max-w-[99rem] overflow-x-clip md:mx-auto">
      <Breadcrumbs />
      <div className="mt-8 grid gap-10 md:grid-cols-[minmax(0,1fr)_280px] md:gap-8 lg:grid-cols-[minmax(0,800px)_280px] lg:justify-between">
        <Article />
        <HelpCategoriesSidebar />
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
