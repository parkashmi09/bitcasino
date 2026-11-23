import { Link } from 'react-router-dom';
import { HelpCategoriesSidebar } from '../components/sections/HelpCategoriesSidebar';
import { SUPPORT_EMAIL } from '@/lib/site';
import { Brand } from '@/components/ui/Brand';
import { withBrand } from '@/lib/branding';
import { useSiteName } from '@/queries/siteConfig';

const RELATED_ARTICLES = [
  ['Dispute Resolution', '/help-center/dispute-resolution'],
  ['General Terms & Conditions', '/help-center/terms-and-conditions'],
  ['Bitcasino AML policy', '/help-center/aml'],
];

const obligations = [
  'You should not attempt to deposit or place any wager on any Bitcasino account that you have requested to be excluded from during your selected self-exclusion.',
  'You should not attempt or proceed to open any new Bitcasino accounts during your self-exclusion timeframe, or forever if permanent self-exclusion has been selected.',
  'If you succeed in opening a new account during a self-exclusion timeframe, we will endeavour to close it at our earliest detection.',
  'Bitcasino are responsible for taking reasonable steps to prevent you from gambling on our products. It is also your responsibility to refrain from breaching these agreed terms.',
  'We may not be able to check your status against a national self-exclusion registry. It is your responsibility to ensure you are not self-excluded and are eligible to participate in wagering.',
  'This is a voluntary request made by you. If you breach this agreement, the platforms and their employees are not liable for losses you may suffer. Losses acquired during your self-exclusion period will not be refunded.',
];

function Breadcrumbs() {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-bulma">
      <Link to="/" className="hover:text-piccolo"><Brand /></Link>
      <span aria-hidden="true">›</span>
      <Link to="/help-center" className="hover:text-piccolo">Help centre</Link>
      <span aria-hidden="true">›</span>
      <Link to="/help-center/terms-and-conditions" className="hover:text-piccolo"><Brand /> Information</Link>
      <span aria-hidden="true">›</span>
      <span><Brand /> Self-Exclusion Terms and Conditions</span>
    </nav>
  );
}

function Article() {
  const site = useSiteName();
  return (
    <article className="min-w-0 max-w-[800px] text-[15px] leading-6 text-bulma md:text-base md:leading-7">
      <div className="mb-8">
        <p className="mb-2 text-[10px] uppercase leading-4 tracking-[0.5px] text-trunks"><Brand /> Information</p>
        <h1 className="font-primary text-2xl font-bold leading-8 text-bulma"><Brand /> Self-Exclusion Terms and Conditions</h1>
      </div>

      <p>By requesting to partake in the <Brand /> self-exclusion process, you agree to the following terms and conditions.</p>
      <p className="mt-4">You start a self-exclusion yourself, signed in, under <Link to="/profile/settings" className="text-piccolo underline hover:text-piccolo-120">Profile &gt; Settings &gt; Responsible gambling</Link>. It can cover the casino, sports, or your whole account.</p>
      <p className="mt-4">The first stage is a 24-hour cooling-off period that stops further activity of the type you chose. <Brand />'s internal checks will detect and determine associated accounts at the earliest opportunity.</p>
      <p className="mt-4">While the cooling-off period runs, you choose the length of the self-exclusion on the same page: 1 day, 1 week, 1 month, 6 months, 1, 2, 3, 5 or 10 years, or permanent. There will be no variations to these options. If you choose none, the cooling-off period simply ends after 24 hours.</p>
      <p className="mt-4">A whole-account self-exclusion also stops you signing in until it ends. The same page lets you set daily, weekly or monthly loss and wager limits.</p>
      <p className="mt-4">We may occasionally implement a self-exclusion timeframe without a request if we believe it is beneficial or necessary for the customer's wellbeing. This will be communicated by email, and these Self-Exclusion Terms and Conditions will apply.</p>
      <p className="mt-4">When you request, or we deem it necessary to add, a <Brand /> self-exclusion, any remaining account balance will be returned to you manually unless you are undergoing a simultaneous security check. You are not permitted to leave a balance in your account during a self-exclusion timeframe.</p>
      <p className="mt-4">Once self-exclusion is applied to your account and associated accounts, it will remain in place until the requested timeframe has finished. It will not be removed, decreased or revoked for any reason. Permanent self-exclusions remain in place forever.</p>
      <p className="mt-4"><Brand /> will use all reasonable endeavours to comply with our Responsible Gambling Self-Exclusion Policy. However, you accept that we will not be held responsible or liable if you attempt to open new accounts or succeed in activity on any of our websites. We are also not liable if you continue to deposit and wager using additional accounts that were not disclosed. Future wagers, reward funds and promotion entries during a requested self-exclusion timeframe will be forfeited, with no return of stakes or payment of winnings and no reinstatement upon completion.</p>

      <p className="mt-4">You acknowledge that:</p>
      <ul className="mt-4 list-disc space-y-3 ps-7 marker:text-piccolo md:ps-8">
        {withBrand(obligations, site).map((obligation) => <li key={obligation}>{obligation}</li>)}
      </ul>

      <p className="mt-4">This is a voluntary agreement. If you breach these terms, all wagering will be dealt with at <Brand />'s discretion. If we suspect, or an investigation shows, that you actively attempted to disguise the source of your account or accounts and affected our ability to identify and block them promptly, this will also be dealt with at our discretion.</p>
      <p className="mt-4">Upon completion of self-exclusion, a customer support agent will contact your registered email address to inform you of account reactivation.</p>
    </article>
  );
}

export function SelfExclusion() {
  const site = useSiteName();
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
          {withBrand(RELATED_ARTICLES, site).map(([label, to]) => (
            <Link key={label} to={to} className="text-xl text-bulma hover:text-piccolo">
              <span className="mb-1 block text-[10px] uppercase leading-4 tracking-[0.5px] text-trunks"><Brand /> Information</span>
              {label}
            </Link>
          ))}
        </div>
      </section>
      {SUPPORT_EMAIL && (
        <section className="mt-10 max-w-[596px] border-t border-beerus pt-8">
          <h2 className="text-2xl font-bold text-bulma">Other ways to get help</h2>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="mt-4 flex items-center gap-4 bg-gohan px-6 py-4 text-bulma hover:bg-beerus">
            <span aria-hidden="true" className="text-4xl leading-none">@</span>
            <span><strong className="block text-xl">Email us</strong><span className="text-sm text-trunks">{SUPPORT_EMAIL}</span></span>
          </a>
        </section>
      )}
    </div>
  );
}
