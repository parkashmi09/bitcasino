import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DepositDialog } from '@/components/layout/DepositDialog';
import { Icon } from '@/components/ui/Icon';

const IMAGE_ROOT = 'https://heathmont.imgix.net/bitcasino/images';

const BENEFITS = [
  ['banner-item-1.svg', 'It\'s totally trending!', 'Worldwide acceptance is here! From flights and car rentals to gaming and shopping.'],
  ['banner-item-2.svg', "It's autonomous!", 'Nobody owns the BTC network, making it open to all.'],
  ['banner-item-3.svg', "It's crazy cheap!", 'The transaction fees are so small they might as well not be there at all.'],
  ['banner-item-4.svg', "It's decentralised!", 'Its network needs no intermediary or fee-charging bank.'],
  ['banner-item-5.svg', "It's sure-fire safe!", "Vault-tight security protocols can't be tampered with."],
  ['banner-item-6.svg', "It's freakin fast!", 'Transactions are processed in seconds, with waiting times decreasing by the day.'],
];

const WALLET_STEPS = [
  {
    title: '1. Choosing and downloading your Bitcoin (BTC) wallet',
    heading: 'Exodus Wallet',
    body: <>Make sure you are visiting the official Exodus.io site on <a href="https://www.exodus.io/" target="_blank" rel="noreferrer">www.exodus.io</a>.</>,
    action: 'Visit Exodus',
    href: 'https://www.exodus.io/',
  },
  {
    title: '2. Purchasing your Bitcoin (BTC) via crypto exchanges',
    heading: 'How to create an account on Kraken',
    body: <>Make sure you are visiting the official Kraken site on <a href="https://www.kraken.com/" target="_blank" rel="noreferrer">www.kraken.com</a>. Sign in and head over to Kraken.</>,
    action: 'Visit Kraken',
    href: 'https://www.kraken.com/',
  },
  {
    title: '3. Spending and making the most of your Bitcoin (BTC)',
    heading: "Here's the best part!",
    body: 'Bitcasino lets you deposit straight from your new Bitcoin wallet. Log in, select BTC, and use the Deposit button to get started.',
  },
];

function BenefitCards() {
  return (
    <div className="rail gap-4 pb-2 sm:overflow-visible">
      {BENEFITS.map(([icon, title, text]) => (
        <article key={title} className="w-[84vw] shrink-0 rounded-s-md bg-gohan p-6 md:w-[444px]">
          <div className="grid min-h-[204px] content-start gap-4 md:min-h-[184px]">
            <img alt="" width="40" height="40" src={`${IMAGE_ROOT}/landings/bitcoin-breakdown/${icon}`} />
            <h2 className="font-secondary text-lg font-normal text-bulma">{title}</h2>
            <p className="m-0 text-sm leading-5 text-bulma">{text}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

function WalletAccordion({ item, open, onToggle }) {
  return (
    <div className="overflow-hidden rounded-s-sm bg-gohan">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center justify-between gap-4 px-5 py-4 text-start font-secondary text-lg font-medium text-bulma"
      >
        <span>{item.title}</span>
        <Icon name="chevron-down" size={22} className={open ? 'shrink-0 rotate-180 transition-transform' : 'shrink-0 transition-transform'} />
      </button>
      {open && (
        <div className="grid gap-8 border-t border-beerus px-5 pb-6 pt-6 text-sm text-trunks md:grid-cols-2 md:items-center md:px-6">
          <div className="grid content-start gap-5">
            <h3 className="font-secondary text-2xl font-normal text-bulma">{item.heading}</h3>
            <p className="m-0 leading-6">{item.body}</p>
            {item.action && <a href={item.href} target="_blank" rel="noreferrer" className="w-fit rounded-i-sm bg-piccolo px-4 py-2 font-medium text-goten hover:bg-piccolo-120">{item.action}</a>}
          </div>
          {item.title.startsWith('1.') && <img alt="Bitcoin wallet" className="w-full rounded-s-sm" src={`${IMAGE_ROOT}/landings/bitcoin-breakdown/step-1-1-1.png?auto=compress,format&w=576&h=492&fit=max`} />}
          {item.title.startsWith('2.') && <img alt="Crypto exchange" className="w-full rounded-s-sm" src={`${IMAGE_ROOT}/landings/bitcoin-breakdown/step-2-1-1.png?auto=compress,format&w=576&h=492&fit=max`} />}
        </div>
      )}
    </div>
  );
}

export function BitcoinBreakdown() {
  const [depositOpen, setDepositOpen] = useState(false);
  const [openWallet, setOpenWallet] = useState(0);

  return (
    <div className="grid min-w-0 gap-8 overflow-hidden">
      <section className="relative -mx-4 overflow-hidden rounded-b-2xl pb-8 pt-12 md:-mx-8 md:pb-10 md:pt-16" style={{ backgroundImage: `url(${IMAGE_ROOT}/promotions/2023/bitcoin-breakdown-banner.jpg?auto=compress,format&fit=max&q=50)`, backgroundPosition: 'center', backgroundSize: 'cover' }}>
        <div className="relative mx-auto grid max-w-[1392px] gap-10 px-5 text-popo md:px-8">
          <div className="grid max-w-xl gap-6">
            <h1 className="font-secondary text-[32px] font-light leading-[1.15] md:text-[56px]">The Big Bitcoin Breakdown</h1>
            <p className="font-secondary text-xl">Find out about all the benefits of Bitcoin</p>
            <button type="button" onClick={() => setDepositOpen(true)} className="w-fit rounded-i-sm bg-piccolo px-4 py-2 font-medium text-goten hover:bg-piccolo-120">Deposit</button>
          </div>
          <BenefitCards />
        </div>
      </section>

      <section className="mx-auto mb-10 grid w-full max-w-[1392px] gap-6 px-0 sm:px-2 md:px-4">
        <h2 className="font-secondary text-3xl font-medium text-bulma">Get some Bitcoins!</h2>
        <div className="grid gap-2">
          {WALLET_STEPS.map((item, index) => <WalletAccordion key={item.title} item={item} open={openWallet === index} onToggle={() => setOpenWallet(openWallet === index ? -1 : index)} />)}
        </div>
      </section>

      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 pb-4 text-sm text-trunks">
        <Link to="/" className="hover:text-piccolo">Bitcasino</Link><span aria-hidden="true">›</span><span>The Big Bitcoin Breakdown</span>
      </nav>

      {depositOpen && <DepositDialog open onClose={() => setDepositOpen(false)} />}
    </div>
  );
}