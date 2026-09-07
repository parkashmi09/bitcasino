import { useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';
import { useMediaQuery } from '@/hooks/useMediaQuery';

/**
 * Fat footer, laid out to the reference site's measurements.
 *
 * Three bands separated by hairlines: an about/links/locale grid, a
 * payment + social + licence row, and an awards strip.
 *
 * The link columns are accordions below `2xl` (1536px) and plain columns at
 * and above it — the same switch the reference makes. Collapsed height is
 * `h-11` (44px), which is exactly `p-3` top + a 20px heading line + `p-3`
 * bottom, so the heading sits flush and everything under it is clipped.
 */

const ABOUT_PARAGRAPHS = [
  'Bitcasino is owned and operated by Moon Technologies B.V registration number 152185, registered address Schout Bij Nacht Doormanweg 40, P.O. Box 4745, Curaçao. CGA (Curacao Gaming Authority) is the licensing authority and the supervisor for Moon Technologies B.V. who is operating under the license number OGL/2023/111/0069 issued on 01.07.2024 and extended under LOK. Contact us at hello@bitcasino.io. Payment agent company is mProcessing Solutions Ltd with address Menandrou 4, 1066, Nicosia, Cyprus and registration number HE 373261.',
  'In order to register for this website, the user is required to accept the General Terms and Conditions . In the event the General Terms and Conditions are updated, existing users may choose to discontinue using the products and services before the said update shall become effective, which is a minimum of two weeks after it has been announced.',
  'Play responsibly - GamCare, Keep It Fun, Gambling Therapy.',
];

const LINK_COLUMNS = [
  {
    heading: 'Games',
    links: [
      { label: 'Slots', to: '/categories/video-slots' },
      { label: 'Roulette', to: '/categories/table-games' },
      { label: 'Live Baccarat', to: '/categories/live-casino' },
      { label: 'Blackjack', to: '/categories/table-games' },
      { label: 'Live Casino', to: '/categories/live-casino' },
      { label: 'Video Poker', to: '/categories/table-games' },
      { label: 'Live Poker', to: '/categories/live-casino' },
      { label: 'Live Game Shows', to: '/categories/game-shows' },
      { label: 'Sportsbook', to: '/categories/crash' },
      { label: 'All providers', to: '/providers' },
    ],
  },
  {
    heading: 'About',
    links: [
      { label: 'Loyalty Club', to: '/vip' },
      { label: 'Rewards', to: '/promotions' },
      { label: 'Blog', to: '/blog' },
      { label: 'Affiliates', to: '/affiliates' },
      { label: 'Help Centre', to: '/help-center' },
      { label: 'Gaming License', to: '/help-center/our-license' },
    ],
  },
  {
    heading: 'Info',
    links: [
      { label: 'General terms and conditions', to: '/help-center/terms-and-conditions' },
      { label: 'Responsible gaming', to: '/help-center/responsible-gaming' },
      { label: 'Self-exclusion', to: '/help-center/self-exclusion' },
      { label: 'Dispute resolution', to: '/help-center/dispute-resolution' },
      { label: 'AML policy', to: '/help-center/aml' },
      { label: 'Fairness and RNG testing methods', to: '/help-center/fairness' },
      { label: 'Are the Games Provably Fair', to: '/help-center/provably-fair' },
      { label: 'KYC policies', to: '/help-center/kyc-policies' },
      { label: 'Account, pay-outs and rewards', to: '/help-center/reward-terms' },
      { label: 'Affiliate terms and conditions', to: '/help-center/affiliate-terms' },
      { label: 'Privacy policy', to: '/help-center/privacy-policy' },
      { label: 'Benefits of Bitcoin', to: '/bitcoin-breakdown' },
    ],
  },
];

const LANGUAGES = ['English', 'Deutsch', 'Español', 'Français', 'Português', '日本語'];

const PAYMENT_METHODS = [
  { name: 'tether', src: '/images/footer/crypto/usdt.png' },
  { name: 'usdc', src: '/images/footer/crypto/usdc.png' },
  { name: 'tron', src: '/images/footer/crypto/trx.png' },
  { name: 'eth', src: '/images/footer/crypto/eth.png' },
  { name: 'matic', src: '/images/footer/crypto/matic.png' },
  { name: 'btc', src: '/images/footer/crypto/btc.png' },
  { name: 'ton', src: '/images/footer/crypto/ton.png' },
  { name: 'bnb', src: '/images/footer/crypto/bnb.svg' },
  { name: 'xrp', src: '/images/footer/crypto/xrp.png' },
  { name: 'doge', src: '/images/footer/crypto/doge.svg' },
  { name: 'ada', src: '/images/footer/crypto/ada.svg' },
  { name: 'ltc', src: '/images/footer/crypto/ltc.png' },
];

const SOCIAL_LINKS = [
  { name: 'telegram', src: '/images/footer/social/telegram.png' },
  { name: 'youtube', src: '/images/footer/social/youtube.png' },
  { name: 'bitcointalk', src: '/images/footer/social/bitcointalk.png' },
  { name: 'twitter', src: '/images/footer/social/x.svg' },
  { name: 'tiktok', src: '/images/footer/social/tiktok.svg' },
];

const AWARDS = [
  { alt: 'EGR award 2020', src: '/images/footer/awards/crm-award-2020.png' },
  { alt: 'EGR award 2020', src: '/images/footer/awards/sm-award-2020.png' },
  { alt: 'EGR award 2021', src: '/images/footer/awards/egr-award-2021.png' },
  { alt: 'EGR award 2022', src: '/images/footer/awards/innovation-2022.png' },
  { alt: 'EGR award 2023', src: '/images/footer/awards/crypto-operator-2023.png' },
];

/** The breakpoint at which the link accordions unfold into plain columns. */
const UNFOLD_AT = '(min-width: 1536px)';

const COLLAPSED_HEIGHT = 44; // h-11 — p-3 + one 20px heading line + p-3
const HEADING_MARGIN = 16; // mb-4 below the heading, clipped while collapsed

function LinkColumn({ heading, links, wide }) {
  const [open, setOpen] = useState(false);
  const [openHeight, setOpenHeight] = useState(0);
  const bodyRef = useRef(null);
  const bodyId = useId();

  const toggle = () => {
    if (!open && bodyRef.current) {
      setOpenHeight(COLLAPSED_HEIGHT + HEADING_MARGIN + bodyRef.current.offsetHeight);
    }
    setOpen((value) => !value);
  };

  // Above 2xl the column is `h-full`; below it we drive the height so the
  // open/close transition has something to interpolate.
  const height = wide ? undefined : open ? openHeight : COLLAPSED_HEIGHT;

  return (
    <div
      style={{ height }}
      className="relative grid h-11 content-start overflow-hidden rounded-md bg-gohan p-3 transition-[height] duration-200 ease-in-out 2xl:h-full 2xl:rounded-none 2xl:bg-transparent 2xl:p-0"
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={wide ? undefined : open}
        aria-controls={wide ? undefined : bodyId}
        className="mb-4 grid cursor-pointer grid-cols-[1fr_auto] items-center text-start 2xl:pointer-events-none 2xl:cursor-default"
      >
        <h2 className="font-primary text-sm font-normal leading-5 text-bulma">{heading}</h2>
        <Icon
          name="chevron-down"
          size={20}
          className={cn(
            'text-bulma transition-transform duration-200 2xl:hidden',
            open && 'rotate-180',
          )}
        />
      </button>

      <div id={bodyId} ref={bodyRef}>
        <nav aria-label={heading} className="grid justify-start gap-4">
          {links.map((link) => (
            <Link
              key={link.label}
              to={link.to}
              className="text-xs leading-4 text-bulma no-underline transition-colors hover:text-piccolo"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

/** Heading shared by the payment / social / licence / awards blocks. */
function BandHeading({ children }) {
  return (
    <h2 className="font-primary text-sm font-normal leading-5 text-bulma">{children}</h2>
  );
}

/** 40px square mark used for both payment methods and social links. */
function MarkRow({ items }) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <a key={item.name} href="#" aria-label={item.name} className="block">
          <img
            src={item.src}
            alt={item.name}
            width={40}
            height={40}
            loading="lazy"
            decoding="async"
            className="inline-block h-10 w-auto"
          />
        </a>
      ))}
    </div>
  );
}

export function Footer() {
  const wide = useMediaQuery(UNFOLD_AT);

  return (
    // Negative margins cancel `main`'s padding so the footer supplies its own,
    // exactly as it does on the reference site: 20px below md, 32px above.
    <footer className="-mx-4 px-5 md:-mx-8 md:px-8">
      <div className="m-auto flex max-w-[99rem] py-6">
        <div className="mx-auto my-0 grid w-full gap-4 pt-0 pb-20 md:max-w-[97.5rem] md:pb-10 xl:w-full xl:max-w-[97rem] xl:pb-16">
          {/* About / links / locale */}
          <div className="grid gap-6 xl:grid-cols-[13.75rem_1fr_auto] xl:items-start xl:justify-between 2xl:gap-16">
            <div className="text-bulma">
              <h2 className="font-primary text-sm font-normal leading-5 text-bulma">
                About Bitcasino.io
              </h2>
              {ABOUT_PARAGRAPHS.map((paragraph, index) => (
                <p key={paragraph.slice(0, 24)} className={cn('m-0 text-sm leading-5', index > 0 && 'mt-5')}>
                  {paragraph}
                </p>
              ))}
            </div>

            <div className="grid items-start gap-1 2xl:grid-flow-col 2xl:gap-3">
              {LINK_COLUMNS.map((column) => (
                <LinkColumn
                  key={column.heading}
                  heading={column.heading}
                  links={column.links}
                  wide={wide}
                />
              ))}
            </div>

            <div className="grid w-max gap-2 justify-self-center">
              <span className="relative block w-full">
                <label htmlFor="footer-language" className="sr-only">
                  Language
                </label>
                <select
                  id="footer-language"
                  defaultValue="English"
                  className="relative z-2 m-0 block h-10 w-full max-w-full cursor-pointer appearance-none rounded-md bg-goku px-4 text-base leading-10 text-trunks shadow-[inset_0_0_0_1px_var(--color-beerus)] transition-shadow focus:outline-none"
                >
                  {LANGUAGES.map((language) => (
                    <option key={language} value={language}>
                      {language}
                    </option>
                  ))}
                </select>
                <Icon
                  name="chevron-down"
                  size={20}
                  strokeWidth={1.5}
                  className="pointer-events-none absolute top-1/2 end-3 z-3 -translate-y-1/2 text-bulma"
                />
              </span>

              <div className="flex h-10 items-center justify-center rounded-lg bg-gohan px-4 text-base text-trunks">
                1 USDT = 1 USD
              </div>
            </div>
          </div>

          <hr className="h-px border-0 bg-beerus" />

          {/* Payment methods / social / licences */}
          <div className="flex flex-col gap-4 lg:flex-row lg:justify-between">
            <div className="flex flex-col gap-4">
              <BandHeading>Payment methods</BandHeading>
              <MarkRow items={PAYMENT_METHODS} />
            </div>

            <div className="flex flex-col gap-4">
              <BandHeading>Follow us</BandHeading>
              <MarkRow items={SOCIAL_LINKS} />
            </div>

            <div className="flex flex-col gap-4">
              <BandHeading>Licenses</BandHeading>
              <div className="flex flex-wrap items-center gap-4 text-bulma">
                <div className="flex flex-wrap items-center gap-4">
                  <a href="#" aria-label="CGA verified certificate">
                    <img
                      src="/images/footer/licenses/cga.svg"
                      alt="CGA Verified Certificate Seal"
                      width={62}
                      height={39}
                      loading="lazy"
                      decoding="async"
                      className="block h-[39px] w-auto"
                    />
                  </a>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <svg
                    width="32"
                    height="16"
                    viewBox="0 0 32 16"
                    role="img"
                    aria-label="18 plus"
                    className="shrink-0"
                  >
                    <text
                      x="0"
                      y="14"
                      fontFamily="var(--font-primary)"
                      fontSize="16"
                      fontWeight="700"
                      fill="currentColor"
                    >
                      18+
                    </text>
                  </svg>
                  <a href="#" aria-label="Hub88">
                    <svg width="72" height="18" viewBox="0 0 72 18" role="img" aria-label="Hub88">
                      <text
                        x="0"
                        y="15"
                        fontFamily="var(--font-primary)"
                        fontSize="18"
                        fontWeight="700"
                        fill="#00A9CE"
                      >
                        H
                      </text>
                      <text
                        x="12"
                        y="15"
                        fontFamily="var(--font-primary)"
                        fontSize="18"
                        fontWeight="700"
                        fill="#0F1724"
                      >
                        ub
                      </text>
                      <text
                        x="35"
                        y="15"
                        fontFamily="var(--font-primary)"
                        fontSize="18"
                        fontWeight="700"
                        fill="#2E9BD6"
                      >
                        88
                      </text>
                    </svg>
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* Awards */}
          <div className="flex flex-col gap-4">
            <hr className="h-px border-0 bg-beerus" />
            <div className="flex flex-col gap-4">
              <BandHeading>Awards</BandHeading>
              <div className="flex flex-wrap gap-1">
                {AWARDS.map((award) => (
                  <a key={award.src} href="#" className="block">
                    <img
                      src={award.src}
                      alt={award.alt}
                      width={120}
                      height={40}
                      loading="lazy"
                      decoding="async"
                      className="inline-block h-10 w-auto"
                    />
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
