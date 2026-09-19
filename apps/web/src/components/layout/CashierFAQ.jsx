import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

/**
 * The in-drawer FAQ screen the reference's `Support & Settings → FAQ` row
 * opens — `cashier_faq`, the sheet that covers the wallet drawer just like
 * the transactions screen does.
 *
 * The reference's step header carries only the back action — no title beside
 * it, because `FAQ` is the first thing in the body below. The body is an
 * accordion of the operator's own answers, a `See all` path to the help
 * centre, and the `support_nav` block: Help Centre and Send us email, both
 * plain external links.
 *
 * The answers are the reference's copy, taken from its `faq-cms-content`;
 * the article links inside them point at the real data-driven help routes
 * (`help-center/:categorySlug/:articleSlug`) where those exist, and at the
 * matching public page otherwise. Tapping one leaves the drawer and takes
 * the player there, exactly like the landing rows do.
 */

/**
 * A FAQ answer. `body` is intentionally JSX: the answers carry `<b>` labels
 * (`Deposit` vs `Withdrawal`), ordered steps and inline links, and a pure-
 * data shape would flatten those into three arrays nobody can scan.
 */
const FAQ = [
  {
    question: 'How do I deposit with crypto?',
    body: (
      <>
        <p>1. Select the cryptocurrency of your choice, then choose the crypto deposit method.</p>
        <p>2. Copy the one-time deposit address and use it in your wallet (or scan the QR code).</p>
        <p>3. Once your transaction is confirmed, you will receive a notification.</p>
        <p>
          See easy step-by-step tutorial example on how to deposit with{' '}
          <Link to="/help-center/help-payment-options/how-do-i-deposit-in-cryptocurrency">
            USDT here
          </Link>
          .
        </p>
        <p>
          Don&apos;t have a crypto wallet? Learn more about it{' '}
          <Link to="/help-center/how-to-buy-crypto/binance-exchange">here</Link>.
        </p>
      </>
    ),
  },
  {
    question: 'How to withdraw crypto?',
    body: (
      <>
        <p>
          1. Choose the cryptocurrency you would like to withdraw, then click
          &ldquo;Withdraw&rdquo;.
        </p>
        <p>2. Enter the amount that you want to withdraw.</p>
        <p>3. Enter your wallet address.</p>
        <p>4. Click the Withdraw button.</p>
      </>
    ),
  },
  {
    question: 'How long do deposits/withdrawals take?',
    body: (
      <>
        <p>
          <b>Deposit</b>
        </p>
        <p>
          Most crypto deposits are processed at lightning speed. However, there may be some
          delays from third-party services. For BTCXE deposits, it may take up to 30 minutes for
          your transaction to be processed due to the time needed for the conversion from fiat
          funds to BTC.
        </p>
        <p>
          <b>Withdrawal</b>
        </p>
        <p>
          Most withdrawals are processed instantly. In the event of large withdrawals, we process
          these withdrawals manually so there may be a slight delay.
        </p>
        <p>
          <Link to="/help-center/help-your-transactions/how-long-does-deposit-withdrawal-take">
            Find out more &gt;
          </Link>
        </p>
      </>
    ),
  },
  {
    question: 'Is it necessary to verify my account (KYC) to withdraw?',
    body: (
      <>
        <p>
          We advise you to verify your account before withdrawing as this helps to prevent any
          possible issues with transactions at a later time.
        </p>
        <p>
          Upon registration, you can submit account verification documents via your profile.
        </p>
        <p>
          Our Player Safety &amp; Assurance Team will contact any users later on if there are
          concerns regarding their use of our platform and source/destination of funds.
        </p>
      </>
    ),
  },
  {
    question: 'What currencies and payment methods do you offer?',
    body: (
      <>
        <p>The available currency options in Bitcasino are:</p>
        <p>
          Tether (USDT), Bitcoin (BTC), Ethereum (ETH), Binance USD (BUSD), Binance Coin (BNB),
          Tron (TRX), Ripple (XRP), TON, Litecoin (LTC), Cardano (ADA), Dogecoin (DOGE).
        </p>
      </>
    ),
  },
  {
    question: 'Do you apply fees on transactions?',
    body: (
      <>
        <p>
          While we don&apos;t apply any transaction fees for deposits and withdrawals at
          Bitcasino, there may be transaction fees you have to pay for using the blockchain
          and/or your bank.
        </p>
      </>
    ),
  },
  {
    question: 'What are the benefits of Bitcoin?',
    body: (
      <>
        <p>
          <Link to="/bitcoin-breakdown">Learn more here &gt;</Link>
        </p>
      </>
    ),
  },
];

/** The reference lands with the first three answers open; the rest stay shut. */
const EXPANDED_ON_OPEN = new Set([0, 1, 2]);

function FAQItem({ question, children, open, onToggle, onNavigate }) {
  return (
    <li className={cn('grid gap-1', open && 'expanded')}>
      <h5
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onToggle();
          }
        }}
        className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-i-sm px-1 text-start text-sm font-medium text-bulma transition-colors hover:text-piccolo"
      >
        <span className="min-w-0 flex-1">{question}</span>
        <Icon
          name={open ? 'chevron-up' : 'chevron-down'}
          size={20}
          className="shrink-0 text-trunks"
        />
      </h5>
      <div
        className={cn(
          'grid grid-rows-[0fr] transition-[grid-template-rows] duration-200',
          open && 'grid-rows-[1fr]',
        )}
      >
        {/* An article link inside an answer is real navigation: it leaves the
            drawer and takes the player to the help page, exactly like the
            landing rows do. Delegated here so the data's `Link`s stay plain. */}
        <div
          className="overflow-hidden"
          onClick={(event) => {
            if (event.target.closest('a')) onNavigate();
          }}
        >
          <div className="grid gap-2 ps-1 pe-2 py-1 text-sm leading-relaxed text-trunks">
            {children}
            {/* Answers have no typographic handling beyond a paragraph; the
                `p` elements carry the spacing, and links are the one accent. */}
          </div>
        </div>
      </div>
    </li>
  );
}

function SupportRow({ icon, label, href, testId }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      data-testid="nav_item"
      id={testId}
      className="group grid grid-cols-[max-content_auto_max-content] cursor-pointer items-center gap-4 rounded-i-xs border-[0.8px] border-transparent bg-transparent py-2 pe-2 ps-1 text-start transition-all duration-200 hover:ps-2.5"
    >
      <Icon name={icon} size={16} className="text-trunks group-hover:text-bulma" />
      <span className="text-sm font-normal text-bulma">{label}</span>
      <Icon name="chevron-right" size={16} className="text-trunks rtl:scale-x-[-1]" />
    </a>
  );
}

export function CashierFAQ({ onBack, onNavigate }) {
  const [open, setOpen] = useState(() => new Set(EXPANDED_ON_OPEN));
  const backRef = useRef(null);

  useEffect(() => {
    backRef.current?.focus();
  }, []);

  const toggle = (index) => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <div
      data-testid="cashier_faq"
      className="absolute inset-0 z-10 flex h-full w-full animate-sheet-in flex-col bg-gohan text-bulma"
    >
      {/* The step header: only the back action, because `FAQ` is already the
          first thing in the body — a second title above it would be one too
          many, which is the reference's own decision. */}
      <div className="flex h-[54px] shrink-0 items-center justify-between px-2">
        <button
          type="button"
          ref={backRef}
          onClick={onBack}
          aria-label="Back to wallet"
          data-testid="back_action"
          className="grid size-10 cursor-pointer place-items-center rounded-i-sm border-[0.8px] border-beerus text-bulma transition-colors hover:bg-heles"
        >
          <Icon name="chevron-left" size={20} />
        </button>
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(auto,100%)] gap-6 overflow-y-scroll px-4 pb-8">
        <div className="flex h-full flex-col justify-between gap-6" data-testid="cashier_faq">
          <div className="grid gap-4">
            <div className="text-base font-medium">FAQ</div>

            <div className="faq-cms-content">
              <ul className="grid gap-1">
                {FAQ.map((entry, index) => (
                  <FAQItem
                    key={entry.question}
                    question={entry.question}
                    open={open.has(index)}
                    onToggle={() => toggle(index)}
                    onNavigate={onNavigate}
                  >
                    {entry.body}
                  </FAQItem>
                ))}
              </ul>
            </div>

            <Button
              as={Link}
              to="/help-center"
              onClick={onNavigate}
              variant="outline"
              size="md"
              className="self-start"
            >
              See all
            </Button>
          </div>

          <div className="grid gap-2">
            <span className="border-t border-beerus" />
            <div className="grid gap-2" data-testid="support_nav">
              <div className="px-1 pt-2 text-xs font-medium text-trunks">Support</div>
              <SupportRow
                icon="help"
                label="Help Centre"
                href="/help-center/"
                testId="cashier.help_centre"
              />
              <span className="border-t border-beerus" />
              <SupportRow
                icon="send"
                label="Send us email"
                href="/help-center?send_email=true"
                testId="cashier.send_email"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}