import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';

/**
 * The long-form editorial block, and the last thing before the testimonials.
 *
 * The reference keeps all of it — trust, game breakdown, providers, promos,
 * the crypto explainer and the getting-started guide — inside **one** collapsed
 * panel rather than as separate bands, so a tall wall of copy never pushes the
 * footer down the page. Measured off it: a `gohan` panel at `rounded-i-xs`,
 * `px-4 py-2` on mobile and `p-8 pb-5` from `sm`, content clamped to 208px
 * (192px from `md`) behind a gradient fade, then a centred `hit` pill.
 *
 * Body type is `font-primary` throughout — the reference forces DM Sans here
 * even on headings, which our base stylesheet would otherwise set in Space
 * Grotesk.
 */

/* Typography, matching the reference's rendered values exactly:
   h2 28/36 -0.56 semibold · h3 20/snug (24/30 from sm) -0.44 medium
   h4 18/28 -0.18 medium · p and lists 16/24 with 16px block margins.

   Links take no hover treatment — only `active` — which is what the reference
   does. A `hover:` prefix here keys off the *container*, not the link, so it
   turns every link in the panel (including the big centred heading) orange
   whenever the block is hovered anywhere. */
const PROSE = [
  'font-primary text-base leading-6 text-bulma',
  '[&_h2]:font-primary [&_h2]:mt-6 [&_h2]:mb-3 [&_h2]:text-[1.75rem] [&_h2]:leading-9 [&_h2]:tracking-[-0.56px] [&_h2]:font-semibold [&_h2]:text-bulma',
  '[&_h3]:font-primary [&_h3]:mt-[10px] [&_h3]:mb-4 [&_h3]:text-xl [&_h3]:leading-snug [&_h3]:tracking-[-0.44px] [&_h3]:font-medium [&_h3]:text-bulma',
  'sm:[&_h3]:m-0 sm:[&_h3]:text-2xl sm:[&_h3]:leading-tight',
  '[&_h4]:font-primary [&_h4]:mt-4 [&_h4]:mb-2 [&_h4]:text-lg [&_h4]:leading-7 [&_h4]:tracking-[-0.18px] [&_h4]:font-medium [&_h4]:text-bulma',
  '[&_p]:my-4 [&_p]:text-base [&_p]:text-bulma',
  '[&_ul]:my-4 [&_ul]:list-disc [&_ul]:ps-10',
  '[&_ol]:my-4 [&_ol]:list-decimal [&_ol]:ps-10',
  '[&_li]:text-base',
  '[&_a]:text-bulma [&_a]:no-underline [&_a]:active:text-hit sm:[&_a]:font-medium sm:[&_a]:text-trunks',
  '[&>*:first-child]:mt-0',
].join(' ');

const COINS = [
  'Tether (USDT)',
  'Bitcoin (BTC)',
  'Ethereum (ETH)',
  'Tron (TRX)',
  'Litecoin (LTC)',
  'Ripple (XRP)',
  'Cardano (ADA)',
  'Dogecoin (DOGE)',
  'Binance Coin (BNB)',
  'Polygon (MATIC)',
  'Binance USD (BUSD)',
  'USD Coin (USDC)',
  'Solana',
  'The Open Network (TON)',
];

const STUDIOS = [
  'Evolution',
  'NetEnt',
  'Microgaming',
  'AvatarUX',
  'OneTouch',
  'PGSoft',
  'Caleta',
  'Hacksaw Gaming',
  'Spinomenal',
  'Betsoft',
];

const ACCOUNT_STEPS = [
  'Visit the Bitcasino website or download the mobile app.',
  'Click the Sign Up button at the top right corner.',
  'Fill in the required fields (e.g., email and username).',
  'Check your email and click the verification link.',
  'Make your first deposit to start playing.',
];

const DEPOSIT_STEPS = [
  'Click the Deposit button at the top right of your screen.',
  'A drop-down will show your QR code, wallet address, and balance.',
  'Choose your preferred cryptocurrency.',
  'Use your crypto wallet or exchange app to scan the QR code or copy the address.',
  'Send your funds and wait a few moments for the deposit to reflect in your account.',
];

const WITHDRAW_STEPS = [
  'Click the Deposit button, then switch to the Withdraw tab.',
  'Choose your withdrawal method and preferred crypto.',
  'Enter the amount or use the quick percentage selector.',
  'Paste your wallet address and review the transaction preview.',
  'Click Confirm to process your withdrawal.',
];

export function TrustSection() {
  const [open, setOpen] = useState(false);
  const contentId = useId();

  return (
    <section className="group/collapsed rounded-i-xs bg-gohan px-4 py-2 sm:p-8 sm:pb-5">
      <div
        id={contentId}
        className={cn(
          'relative overflow-hidden text-bulma',
          !open && 'max-h-52 md:max-h-48',
        )}
      >
        <div className={PROSE}>
          <h2 className="text-center">
            <Link to="/promotions">
              Bitcasino is the world’s first licensed crypto casino with highest
              bet limits in the industry and a 100% first deposit match bonus of
              up to 1,500 USDT
            </Link>
          </h2>

          <p>
            Let Bitcasino take your gaming experience to the next level, offering
            you endless opportunities to play with your favourite cryptocurrency
            and score big wins.
          </p>
          <p>
            With unmatched <Link to="/promotions">welcome offers</Link>, exciting
            bonuses, and a world-class game selection, Bitcasino continues to lead
            the way as one of the most preferred crypto casinos online. Recognised
            by the prestigious <Link to="/blog">EGR awards</Link> year after year,
            we remain a trusted name among players around the globe.
          </p>
          <p>
            As an award-winning BTC casino, Bitcasino.io is known not just for
            innovation, but also for security, convenience, and a commitment to
            elevating your gameplay.
          </p>
          <p>Discover what’s in store when you choose to play at Bitcasino.</p>

          <h2>A Bitcoin casino you can trust</h2>
          <p>
            Bitcasino is the world’s first licensed Bitcoin casino, officially
            recognised by Curaçao eGaming and supported by Hub88, two of the most
            reputable names in online gaming regulation. Our{' '}
            <Link to="/help-center/our-license">operating license</Link> is held
            by Moon Technologies B.V., ensuring full transparency and compliance.
          </p>
          <p>
            As a licensed and secure crypto casino, Bitcasino guarantees that all
            your funds, transactions, and data are protected with industry-grade
            encryption and blockchain-integrated safeguards. You can place your
            wagers with confidence, knowing your gameplay is backed by proven
            reliability and trust.
          </p>
          <p>
            Whether you play with Bitcoin (BTC), Ethereum (ETH), or other
            supported cryptocurrencies, Bitcasino offers a seamless experience
            with fast deposits, smooth gameplay, and easy access to the best
            crypto casino features available.
          </p>
          <p>
            Start your journey today and discover how Bitcasino makes crypto
            gaming safe, simple, and rewarding.
          </p>

          <h2>Selection of games</h2>
          <p>
            At Bitcasino, finding top-quality casino games is never a challenge.
            We offer a vast selection of titles from leading game providers, each
            with its own unique theme, features, and gameplay style to suit every
            kind of player.
          </p>
          <p>
            Explore thousands of games all in one place. Every game on Bitcasino
            is developed by some of the most trusted and innovative names in the
            industry.
          </p>
          <p>
            With thousands of exceptional titles at your fingertips, you can
            expect nothing less than world-class gaming with exciting bonus
            features, stunning visuals, and captivating gameplay that keeps you
            coming back for more.
          </p>

          <h2>Fun mode</h2>
          <p>
            Not quite ready to wager real crypto? No problem. With Bitcasino’s Fun
            Mode, you can explore your favourite games without risking any funds.
            It’s the perfect way to get familiar with different titles and test
            out features before you commit.
          </p>
          <p>
            To activate Fun Mode, simply toggle the switch at the bottom of your
            game screen. The game will reload in demo mode, letting you explore
            its payout frequency, bonus mechanics, and overall gameplay—no deposit
            required.
          </p>
          <p>
            Once you’ve found the game that suits your style, switching to Real
            Mode takes just a click, so you can start playing for real crypto
            rewards anytime.
          </p>

          <h2>Real mode</h2>
          <p>
            Found the perfect game? It’s time to switch to Real Mode and play for
            real winnings. Place your wager, take the plunge, and experience the
            thrill of high-stakes crypto gaming. This is where the excitement—and
            the biggest payouts—begin.
          </p>

          <h2>Tournaments</h2>
          <p>
            Looking to level up the excitement? Bitcasino’s{' '}
            <Link to="/tournaments">tournaments</Link> and promos add an extra
            layer of challenge and reward to your gameplay.
          </p>
          <p>
            With daily tournaments and leaderboard competitions, every spin or bet
            brings a chance to climb the ranks and claim extra prizes, whether
            it’s cash rewards, free spins, or exclusive bonuses.
          </p>
          <p>
            To join, check out the Tournaments section in the menu on the left
            side of your screen. Choose an event, opt in, and start playing your
            way to the top.
          </p>
          <p>
            Note: You can only participate in one tournament at a time—so pick
            your best shot and go all in!
          </p>

          <h2>Payment methods</h2>
          <p>
            As a fully crypto-focused casino, Bitcasino offers some of the most
            convenient and secure{' '}
            <Link to="/help-center/payment-options">payment options</Link> for
            deposits and withdrawals.
          </p>
          <p>
            You can easily use your preferred cryptocurrency to fund your account
            and cash out your winnings. For added convenience, Bitcasino partners
            with trusted services that allow you to convert fiat to crypto—making
            it simple to get started, even if you’re new to digital assets.
          </p>
          <p>
            Our primary supported currency is{' '}
            <Link to="/blog/tether-gambling">Tether (USDT)</Link>, a stablecoin
            that combines the speed of crypto with the value stability of fiat.
            It’s ideal for players who want reliable value without market
            volatility.
          </p>
          <p>Here’s a list of all the supported crypto payments at Bitcasino:</p>
          <ul>
            {COINS.map((coin) => (
              <li key={coin}>{coin}</li>
            ))}
          </ul>

          <h2>Play Bitcoin Casino: Best Online BTC Casino Games</h2>
          <p>
            Finding the perfect game at Bitcasino is as easy as it gets. With an
            extensive library of over 5,000 games from some of the most reputable
            game providers in the industry, you’ll never run out of exciting,
            high-quality, and rewarding options to explore.
          </p>
          <p>
            Whether you’re into slots, live dealer tables, or unique formats,
            Bitcasino has something to match every style of play.
          </p>
          <p>
            Browse the game categories below and start playing at one of the top
            Bitcoin casinos online—where crypto meets world-class entertainment.
          </p>

          <h3>Slot games</h3>
          <p>
            Choose from{' '}
            <Link to="/categories/video-slots">over 4,000 slot games</Link> at
            Bitcasino—each offering unique themes, features, and ways to win. With
            so many options, finding the perfect slot to match your style is
            effortless.
          </p>
          <p>
            From classic fruit machines to modern video slots packed with bonus
            rounds, multipliers, and free spins, every title delivers a fresh and
            exciting twist to the traditional slot experience.
          </p>
          <p>
            All our slots come from the industry’s most reputable game providers,
            so you can expect top-tier quality in terms of graphics, sound, and
            performance.
          </p>
          <p>
            Spin the reels, unlock rewarding features, and chase big wins as you
            explore Bitcasino’s diverse and dynamic slot collection.
          </p>

          <h3>Live casino</h3>
          <p>
            Looking for the thrill of a real casino without leaving home?
            Bitcasino’s{' '}
            <Link to="/categories/live-casino">live casino section</Link> brings
            the authentic casino atmosphere to your screen—complete with
            professional dealers, HD streaming, and real-time action.
          </p>
          <p>
            Play Bitcoin live casino games like blackjack, baccarat, roulette, and
            more, all hosted by experienced croupiers who guide you every step of
            the way.
          </p>
          <p>
            With immersive visuals, interactive features, and secure crypto
            betting, Bitcasino’s live casino delivers a high-end gaming experience
            that’s as close to a physical casino as it gets.
          </p>

          <h3>Table games</h3>
          <p>
            At Bitcasino, there’s no shortage of classic table games tailored for
            crypto players. Whether you’re into strategic showdowns or fast-paced
            action, you’ll find your favourites right here—available in both video
            and live formats.
          </p>
          <p>Explore our top table games below:</p>

          <h4>Poker</h4>
          <p>
            <Link to="/categories/table-games">Poker</Link> remains one of the
            most iconic and skill-based games in the casino world—and it’s a
            favourite at Bitcasino for good reason.
          </p>
          <p>
            Unlike most casino games that rely heavily on chance, poker demands
            strategy, timing, and psychological play. We offer a wide variety of
            poker formats—some simple for beginners, others designed for seasoned
            pros. Choose from video poker or live dealer tables, and bring your
            best poker face to the table.
          </p>

          <h4>Blackjack</h4>
          <p>
            <Link to="/categories/table-games">Blackjack</Link> is a go-to classic
            for players who enjoy quick, strategic rounds and simple rules. It’s
            easy to learn and endlessly replayable.
          </p>
          <p>
            The objective is simple: beat the dealer by getting a hand value
            closest to 21 without going over. If you’ve got the focus and
            discipline, you’ve got a real shot at walking away with solid wins.
          </p>
          <p>
            Play with Bitcoin and take on the dealer in one of the most rewarding
            card games in the world.
          </p>

          <h4>Baccarat</h4>
          <p>
            <Link to="/categories/live-casino">Baccarat</Link> is another
            fan-favourite for its elegant simplicity and low learning
            curve—perfect for beginners and casual players alike.
          </p>
          <p>
            Bet on the player, the banker, or a tie, and let the cards do the
            rest. It’s fast-paced, fun, and comes with excellent odds.
          </p>
          <p>
            Try your luck on one of Bitcasino’s many baccarat tables and discover
            why this game has stood the test of time.
          </p>

          <h4>Craps</h4>
          <p>
            If you love dice games with fast action and multiple betting options,{' '}
            <Link to="/categories/table-games">craps</Link> delivers excitement in
            every roll.
          </p>
          <p>
            The goal is to predict the outcome of a roll—or series of rolls—by
            placing bets on the craps table layout. Whether you’re betting on a
            Pass Line or going for more advanced bets, craps offers thrilling
            possibilities and strong payout potential.
          </p>

          <h4>Roulette</h4>
          <p>
            <Link to="/categories/table-games">Roulette</Link> is the ultimate
            casino game of anticipation and chance. Watch the wheel spin, place
            your bets, and wait for the ball to land—it’s classic, stylish, and
            deeply rewarding.
          </p>
          <p>
            With options to bet on red/black, odd/even, or specific numbers, the
            game allows for a variety of betting styles to suit your risk level.
          </p>

          <h3>Lottery</h3>
          <p>
            Explore a wide selection of bingo, keno, and other{' '}
            <Link to="/categories/jackpots">number-based titles</Link> that offer
            fast gameplay, simple mechanics, and exciting jackpot potential. These
            games are perfect for players who enjoy straightforward betting with a
            chance to win big—no complex rules required.
          </p>

          <h2>Software providers</h2>
          <p>
            Bitcasino partners with the leading game{' '}
            <Link to="/providers">providers</Link> in the crypto casino industry
            to offer a top-tier selection of high-quality games. Each title is
            built with advanced graphics, smooth animation, immersive sound, and
            standout design.
          </p>
          <p>Here are some of our top developers:</p>
          <ul>
            {STUDIOS.map((studio) => (
              <li key={studio}>{studio}</li>
            ))}
          </ul>

          <h2>Promotions</h2>
          <p>
            Bitcasino is a crypto casino that rewards players at every
            opportunity. From daily to monthly{' '}
            <Link to="/promotions">promotions</Link>, you’ll find a range of
            offers designed to boost your gameplay, including cashback, bonuses,
            and limited-time events. Sign up to start unlocking extra rewards as
            you play.
          </p>

          <h3>VIP</h3>
          <p>
            Looking for exclusive treatment? Bitcasino’s{' '}
            <Link to="/vip">VIP Club</Link> is designed for our most dedicated
            players. By invitation only, this program offers access to premium
            rewards, special bonuses, and tailor-made promotions you won’t find
            elsewhere.
          </p>
          <p>
            As a VIP, you can enjoy the support of a personal account manager,
            faster withdrawals, and high-roller perks—plus the prestige of being
            part of one of the most respected loyalty clubs in the crypto casino
            world.
          </p>

          <h2>Crypto casino online: All about blockchain and betting</h2>
          <p>
            Bitcasino is built to deliver a smooth and rewarding crypto betting
            experience. By using your digital assets, you can play your favourite
            games and win real prizes with speed, security, and flexibility that
            traditional casinos can’t match.
          </p>
          <p>Here’s what sets crypto casinos like Bitcasino apart:</p>

          <h4>Anonymity</h4>
          <p>
            Crypto casinos offer greater privacy. Instead of sharing personal or
            banking details, you only need a wallet address to deposit and
            withdraw. This keeps your identity and financial data protected from
            potential threats.
          </p>

          <h4>Fast Transactions</h4>
          <p>
            Deposits and withdrawals with crypto are nearly instant. You won’t
            have to wait hours or days like with traditional banking methods. With
            Bitcasino, you get quick access to your funds whenever you need them.
          </p>

          <h4>Security</h4>
          <p>
            Crypto transactions are verified and recorded on the blockchain using
            advanced encryption. Every transaction is tamper-proof, ensuring your
            funds and data remain safe at all times.
          </p>

          <h2>Access your games anywhere</h2>
          <p>
            Play your favourite Bitcasino games anytime, anywhere. Whether you’re
            on desktop or mobile, Bitcasino is designed to give you a smooth,
            flexible gaming experience tailored to your style.
          </p>
          <p>
            For desktop users, simply access Bitcasino through your preferred web
            browser. If you’re on mobile, we recommend downloading the{' '}
            <Link to="/blog/bitcasino-app-guide">Bitcasino app</Link> for seamless
            access to games on the go.
          </p>

          <h2>Getting started at Bitcasino</h2>
          <p>
            Ready to play? Follow these quick steps to create your account and
            start your journey:
          </p>

          <h3>How to create an account</h3>
          <ol>
            {ACCOUNT_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>

          <h3>How to deposit with crypto</h3>
          <ol>
            {DEPOSIT_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>

          <h3>How to withdraw from Bitcasino</h3>
          <ol>
            {WITHDRAW_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>

        {!open && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-linear-to-t from-gohan to-transparent md:h-[4.5rem]"
          />
        )}
      </div>

      <div className="flex justify-center pt-4">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={contentId}
          className="flex h-10 items-center justify-center rounded-i-sm bg-hit px-4 py-2 text-base font-normal whitespace-nowrap text-bulma transition duration-200 select-none active:scale-90"
        >
          {open ? 'Show less' : 'Show more'}
        </button>
      </div>
    </section>
  );
}
