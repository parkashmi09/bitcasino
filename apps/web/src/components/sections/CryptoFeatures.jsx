import { Icon } from '@/components/ui/Icon';

const ITEMS = [
  {
    icon: 'lock',
    title: 'Privacy',
    body: 'Accounts are crypto-first, so registration asks for far less personal data than a card-based casino needs. Verification is requested only where the licence requires it.',
  },
  {
    icon: 'bolt',
    title: 'Fast transactions',
    body: 'Deposits confirm as soon as the network settles the block. Withdrawals are queued immediately rather than held for a banking day.',
  },
  {
    icon: 'shield',
    title: 'Security',
    body: 'Funds sit in segregated wallets, game outcomes come from certified generators, and every balance-affecting event is written to an audit log.',
  },
];

export function CryptoFeatures() {
  return (
    <section className="my-6 rounded-i-md bg-gohan p-6 md:p-10">
      <h2 className="font-secondary text-xl font-light leading-8 text-bulma md:text-2xl">
        Why players choose crypto
      </h2>

      <ul className="mt-6 grid gap-6 md:grid-cols-3">
        {ITEMS.map((item) => (
          <li key={item.title}>
            <span className="grid size-11 place-items-center rounded-i-md bg-piccolo text-goten">
              <Icon name={item.icon} size={22} />
            </span>
            <h3 className="mt-3 font-secondary text-base font-medium text-bulma">
              {item.title}
            </h3>
            <p className="mt-1.5 text-xs leading-5 text-trunks">{item.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
