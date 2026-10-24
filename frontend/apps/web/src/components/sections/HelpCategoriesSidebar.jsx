import { Link } from 'react-router-dom';

const HELP_CATEGORIES = [
  ['Getting Started', '/help-center/help-getting-started'],
  ['Your Account', '/help-center/help-your-account'],
  ['Your Transactions', '/help-center/help-your-transactions'],
  ['Your rewards', '/help-center/help-your-bonuses'],
  ['Payment Options', '/help-center/help-payment-options'],
  ['About Crypto', '/help-center/help-about-bitcoin'],
  ['How to buy Crypto', '/help-center/how-to-buy-crypto'],
  ['Loyalty Club', '/help-center/help-loyalty'],
  ['Bitcasino Information', '/help-center/help-terms-and-conditions'],
];

/** Shared category navigation for help-centre and policy pages. */
export function HelpCategoriesSidebar() {
  return (
    <aside className="hidden min-w-72 self-start md:block md:ps-8 lg:min-w-[280px] lg:ps-4">
      <h2 className="mb-4 text-2xl font-normal leading-8 text-bulma">Categories</h2>
      <div className="divide-y divide-beerus border-t border-beerus">
        {HELP_CATEGORIES.map(([label, to]) => (
          <Link key={label} to={to} className="block py-4 text-base text-bulma hover:text-piccolo">
            {label}
          </Link>
        ))}
      </div>
    </aside>
  );
}
