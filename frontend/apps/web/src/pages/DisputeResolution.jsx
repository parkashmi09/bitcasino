import { Link } from 'react-router-dom';
import { HelpCategoriesSidebar } from '../components/sections/HelpCategoriesSidebar';

const RELATED_ARTICLES = [
  ['General Terms & Conditions', '/help-center/terms-and-conditions'],
  ['Bitcasino AML policy', '/help-center/aml'],
  ['Bitcasino Reward Terms & Conditions', '/help-center/reward-terms'],
];

const complaintScope = [
  'Account access or security concerns.',
  'Deposits, withdrawals, and payment processing issues.',
  'Technical issues affecting gameplay.',
  'Alleged breaches of our terms and conditions.',
  'Responsible gaming or self-exclusion concerns.',
  'Any other disputes arising from the use of our services.',
];

const complaintDetails = [
  "Complainant's name, address, and place of residence.",
  "Complainant's account number and/or username.",
  'Date of the complaint.',
  'Registered email address.',
  'Description of the conduct being disputed, using predetermined category topics where applicable.',
  'Language option: English or the language of the target market.',
  'Any supporting documentation the player wishes to include as part of the complaint.',
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
      <span>Dispute Resolution</span>
    </nav>
  );
}

function Article() {
  return (
    <article className="min-w-0 max-w-[800px] text-[15px] leading-6 text-bulma md:text-base md:leading-7">
      <div className="mb-8">
        <p className="mb-2 text-[10px] uppercase leading-4 tracking-[0.5px] text-trunks">Bitcasino Information</p>
        <h1 className="font-primary text-2xl font-bold leading-8 text-bulma">Dispute Resolution</h1>
      </div>

      <h2 className="mb-4 mt-10 font-primary text-xl font-bold leading-7 text-bulma">Player Complaint Procedure</h2>
      <h2 className="mb-4 mt-10 font-primary text-xl font-bold leading-7 text-bulma">1. Purpose</h2>
      <p>The purpose of this Complaints Handling Procedure (the "Procedure") is to establish a clear and structured process for managing player complaints fairly, transparently, and efficiently. As a Curaçao eGaming licensed online casino, Moon Technologies B.V. is committed to providing players with a reliable avenue for resolving disputes related to our gaming services, including account issues, transactions, and gameplay concerns.</p>
      <p className="mt-4">This Procedure aims to:</p>
      <ul className="mt-4 list-disc space-y-2 ps-7 marker:text-piccolo md:ps-8">
        <li>Provide a standardized approach to managing and resolving customer complaints.</li>
        <li>Ensure compliance with regulatory requirements and industry best practices.</li>
        <li>Enhance customer satisfaction and maintain the company's reputation.</li>
        <li>Identify areas for improvement in Moon Technologies B.V.'s products, services, and processes.</li>
      </ul>

      <h2 className="mb-4 mt-10 font-primary text-xl font-bold leading-7 text-bulma">2. Statement</h2>
      <p>We recognize the importance of customer satisfaction and responsible gaming. This procedure ensures that all complaints are handled professionally, impartially, and in compliance with the regulatory requirements set forth by Curaçao eGaming. Our goal is to provide efficient resolution to disputes while upholding fairness and integrity in our operations.</p>

      <h2 className="mb-4 mt-10 font-primary text-xl font-bold leading-7 text-bulma">3. Scope</h2>
      <p>This procedure applies to all registered players of our online casino who wish to raise a complaint about areas including, but not limited to:</p>
      <ul className="mt-4 list-disc space-y-2 ps-7 marker:text-piccolo md:ps-8">
        {complaintScope.map((item) => <li key={item}>{item}</li>)}
      </ul>

      <h2 className="mb-4 mt-10 font-primary text-xl font-bold leading-7 text-bulma">4. Complaint Resolution Process</h2>
      <h3 className="mb-3 mt-8 text-lg font-bold leading-7 text-bulma">4.1 Submission of Complaint</h3>
      <p>Complaints must be submitted using the designated email address <a href="mailto:complaints@bitcasino.io" className="underline hover:text-piccolo">complaints@bitcasino.io</a> and the designated Complaint Form provided by Moon Technologies B.V., in compliance with Curaçao Gaming Authority (CGA) guidelines. Submission of a complaint comes at no cost.</p>
      <p className="mt-4">Complaints must be filed within six months from the date of the incident related to the player's participation in a Game of Chance. The complaint must include:</p>
      <ul className="mt-4 list-disc space-y-2 ps-7 marker:text-piccolo md:ps-8">
        {complaintDetails.map((item) => <li key={item}>{item}</li>)}
      </ul>

      <h3 className="mb-3 mt-8 text-lg font-bold leading-7 text-bulma">4.2 Acknowledgment</h3>
      <p>The Casino shall promptly acknowledge receipt of any complaint, and in any event no later than one week after receiving it. Written confirmation will be sent to the complainant, outlining the complaint-handling procedure and the steps that will be taken.</p>

      <h3 className="mb-3 mt-8 text-lg font-bold leading-7 text-bulma">4.3 Investigation</h3>
      <p>Our support team will conduct a thorough investigation, gathering all necessary information to assess the validity of the complaint. Players may be asked to provide additional details or documentation if required.</p>

      <h3 className="mb-3 mt-8 text-lg font-bold leading-7 text-bulma">4.4 Resolution</h3>
      <p>The Casino shall notify the complainant of the status of their complaint within four weeks of receipt. The response shall include:</p>
      <ul className="mt-4 list-disc space-y-2 ps-7 marker:text-piccolo md:ps-8">
        <li>If the complaint will not be processed, a written explanation detailing the reason for the decision.</li>
        <li>If the complaint is processed, written notification of the final decision, including supporting details and justification.</li>
        <li>If additional time is required, the complainant will be informed of the expected resolution timeline. This limit may be extended once, in writing, by a further four weeks.</li>
      </ul>
      <p className="mt-4"><strong>N.B:</strong> Complaints related to responsible gaming will be prioritized due to their potential impact on player wellbeing. We shall use best efforts to resolve these cases within five business days. If additional time is required, the player will be informed of the delay, which shall not exceed two weeks.</p>
      <p className="mt-4">The Company shall offer its players, at any time, the opportunity to use alternative dispute resolution (ADR) at the Company's own expense.</p>

      <h3 className="mb-3 mt-8 text-lg font-bold leading-7 text-bulma">4.5 Escalation</h3>
      <p>If the player is not satisfied with the resolution, they may escalate the complaint to a CGA-certified ADR provider. In January 2026, the first Curaçao ADR providers were certified by the CGA. As we are currently acquiring certified ADR services, this procedure will be updated once a designated provider has been appointed.</p>

      <h3 className="mb-3 mt-8 text-lg font-bold leading-7 text-bulma">4.6 Final Decision (ADR)</h3>
      <p>The decision made by the ADR provider will be considered final and binding.</p>
      <p className="mt-4">By adhering to this policy, we aim to maintain transparency, fairness, and player trust while operating within Curaçao eGaming licensing regulations.</p>
      <p className="mt-4">Please be advised that the CGA will not resolve or make decisions on complaints regarding gambling-related transactions.</p>
      <p className="mt-4">All complaint records shall be securely maintained for a minimum of five years. This includes documentation of unresolved complaints and those escalated to Alternative Dispute Resolution (ADR) or legal proceedings.</p>

      <h2 className="mb-4 mt-10 font-primary text-xl font-bold leading-7 text-bulma">5. Terms and Conditions</h2>
      <p>The Complaints procedure statement is visible and accessible on our website. The Complaints procedure is also clearly outlined in the Terms and Conditions.</p>

      <h2 className="mb-4 mt-10 font-primary text-xl font-bold leading-7 text-bulma">6. Complaint Template</h2>
      <p>The Complaint Template form can be accessed <a href="https://cdn.coingaming.io/docs/bitcasino_complaints_template.docx" target="_blank" rel="noreferrer" className="underline hover:text-piccolo">here</a>.</p>
    </article>
  );
}

export function DisputeResolution() {
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
