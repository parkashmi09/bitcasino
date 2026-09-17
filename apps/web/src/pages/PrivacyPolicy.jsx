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

function Breadcrumbs() {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-bulma">
      <Link to="/" className="hover:text-piccolo">Bitcasino</Link>
      <span aria-hidden="true">›</span>
      <Link to="/help-center" className="hover:text-piccolo">Help centre</Link>
      <span aria-hidden="true">›</span>
      <Link to="/help-center/terms-and-conditions" className="hover:text-piccolo">Bitcasino Information</Link>
      <span aria-hidden="true">›</span>
      <span>Bitcasino Privacy Policy</span>
    </nav>
  );
}

function Categories() {
  return (
    <aside className="hidden min-w-72 self-start md:block md:ps-8 lg:min-w-[280px] lg:ps-4">
      <h2 className="mb-4 text-2xl font-normal leading-8 text-bulma">Categories</h2>
      <div className="divide-y divide-beerus border-t border-beerus">
        {CATEGORIES.map(([label, to]) => <Link key={label} to={to} className="block py-4 text-base text-bulma hover:text-piccolo">{label}</Link>)}
      </div>
    </aside>
  );
}

function Article() {
  return (
    <article className="min-w-0 max-w-[800px] text-[15px] leading-6 text-bulma md:text-base md:leading-7">
      <div className="mb-8">
        <p className="mb-2 text-[10px] uppercase leading-4 tracking-[0.5px] text-trunks">Bitcasino Information</p>
        <h1 className="font-primary text-2xl font-bold leading-8 text-bulma">Bitcasino Privacy Policy</h1>
      </div>

      <p><em>Updated: 19.08.2021</em></p>
      <p className="mt-4">Bitcasino (the Company) takes protecting your privacy very seriously.</p>
      <p className="mt-4">We implement suitable technical and administrative controls in our endeavours to keep your personal information protected at all times. This Privacy Policy explains how your personal information is handled. By using our services, you agree to accept these terms.</p>
      <p className="mt-4">Personal Information is any information that allows you to be identified and may include your name and address, date of birth, payment details and any other information you may wish to provide or that is collected about you. We take measures to ensure that use of your Personal Information is compliant with data protection and privacy regulations in the countries where we operate. This Privacy Policy applies to Personal Information we collect when you use our websites or otherwise interact with us.</p>
      <p className="mt-4">The controller of the personal data is Moon Technologies B.V.</p>

      <h2 className="mb-4 mt-10 text-xl font-bold leading-7 text-bulma">Purpose for the collection of personal data</h2>
      <p>Your personal information is collected and used for the following reasons:</p>
      <ul className="my-4 list-disc space-y-1 ps-6 marker:text-piccolo">
        <li>To provide you with our services</li>
        <li>To make more of such services available to you where possible and appropriate</li>
        <li>Setting up and managing your account</li>
        <li>For the purposes of security and control</li>
        <li>To satisfy regulatory and legal requirements</li>
        <li>For historical and statistical purposes</li>
        <li>To notify you about updates to our software or services</li>
      </ul>
      <p>We may use your personal information to contact you from time to time about our products, events, activities, projects, developments and special offers. We may contact you via email, live chat or internal support ticket.</p>
      <p className="mt-4">When you supply us with your personal information, you agree that our use of it in accordance with this Privacy Policy is not a breach of your rights under the Data Protection Act governed by the law of Curaçao.</p>
      <p className="mt-4">You may opt out from receiving promotional or marketing materials at any time by contacting us.</p>

      <h2 className="mb-4 mt-10 text-xl font-bold leading-7 text-bulma">Disclosing personal information to third parties</h2>
      <p>Your personal information will not be disclosed to anyone other than Company employees who require access to provide you with a service, except where we are required by law or legal process to disclose it to relevant authorities.</p>
      <p className="mt-4">We may disclose Personal Information to government institutions where required by law.</p>

      <h2 className="mb-4 mt-10 text-xl font-bold leading-7 text-bulma">Protection of your personal information</h2>
      <p>We employ physical, electronic and managerial procedures to safeguard the security of the data you provide. SSL encryption is used on our Website for all sensitive data. We advise you to take all reasonable precautions to protect your personal data while using the Internet.</p>
      <p className="mt-4">Personal Information will be kept as long as it is needed to provide the services and as stipulated by law. You may ask for Personal Information to be deleted, although in some cases we may refuse based on legal requirements.</p>
      <p className="mt-4">Should the purpose of processing change, we will inform you as soon as possible. Where consent is needed, we will obtain it from you.</p>

      <h2 className="mb-4 mt-10 text-xl font-bold leading-7 text-bulma">Access to your personal information</h2>
      <p>You have the right to access information we hold about you. You can review and update your information from your Account page, or contact the Company service department to ask for details of the information we hold. You may request incorrect information to be corrected or, where applicable, removed. We reserve the right to ask for a written request.</p>

      <h2 className="mb-4 mt-10 text-xl font-bold leading-7 text-bulma">Your right to be forgotten</h2>
      <p>You have the right to have your personal data deleted in certain situations. To request deletion, contact <a href="mailto:cs@bitcasino.io" className="underline hover:text-piccolo">cs@bitcasino.io</a> and we will respond within a month. If we erase your data, we will also notify relevant third parties where possible. If your request is denied, we will explain why and you have the right to complain to the supervisory authority.</p>

      <h2 className="mb-4 mt-10 text-xl font-bold leading-7 text-bulma">Cookies</h2>
      <p>A cookie is a data packet used for web analytics and to recognize visitors and facilitate the login process. Cookies used by the Company are only set if the user agrees and expire within a maximum of four weeks. You may turn off cookies, but doing so may restrict or prevent use of the service.</p>

      <h2 className="mb-4 mt-10 text-xl font-bold leading-7 text-bulma">Privacy Commitment</h2>
      <p>Our privacy guidelines are communicated to every employee to ensure your personal information remains confidential. Where our Website contains links to other sites, we do not share your personal information with those sites and are not responsible for their privacy policies.</p>
      <p className="mt-4">This Privacy Policy may change at any time. We advise you to review it periodically. If we plan to use your personal information in a way that differs from the purpose stated at collection, we will inform you.</p>
    </article>
  );
}

export function PrivacyPolicy() {
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
          {RELATED_ARTICLES.map(([label, to]) => <Link key={label} to={to} className="text-xl text-bulma hover:text-piccolo"><span className="mb-1 block text-[10px] uppercase leading-4 tracking-[0.5px] text-trunks">Bitcasino Information</span>{label}</Link>)}
        </div>
      </section>
      <section className="mt-10 max-w-[596px] border-t border-beerus pt-8">
        <h2 className="text-2xl font-bold text-bulma">Other ways to get help</h2>
        <a href="mailto:hello@bitcasino.io" className="mt-4 flex items-center gap-4 bg-gohan px-6 py-4 text-bulma hover:bg-beerus"><span aria-hidden="true" className="text-4xl leading-none">@</span><span><strong className="block text-xl">Email us</strong><span className="text-sm text-trunks">hello@bitcasino.io</span></span></a>
      </section>
    </div>
  );
}