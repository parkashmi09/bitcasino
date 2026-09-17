import { Link } from 'react-router-dom';
import { HelpCategoriesSidebar } from '../components/sections/HelpCategoriesSidebar';

const RELATED_ARTICLES = [
  ['Dispute Resolution', '/help-center/dispute-resolution'],
  ['General Terms & Conditions', '/help-center/terms-and-conditions'],
  ['Bitcasino AML policy', '/help-center/aml'],
];

const EXCLUDED_GAMES = [
  ['3Oaks', ['African Spirit Sticky Wilds', 'Coin Lamp']],
  ['7777Gaming', ['Book of Thracians', 'Club Mr. Luck', "Don't Crash", 'Gingers and Gems', 'Linko Party', 'Multi Xpress', 'Pearl of Egypt Kingdom']],
  ['All41', ['Le Kaffee Bar']],
  ['Amusnet', ['All games']],
  ['Asia Gaming', ['All games']],
  ['AvatarUX', ['Cosmic Jokers', 'Majestic Meow', "Toad's Bounty"]],
  ['Aviatrix', ['Aviatrix']],
  ['Betsoft', ['2 Million B.C.', 'After Night Falls', "Alkemor's Elements", 'At The Copan', 'Back to Venus', 'Dim Sum Prize', 'Dr. Jekyll and Mr. Hyde', 'Event Horizon', 'Faerie Spells', "Giovannis Gems", 'Good Girl, Bad Girl', 'Gypsy Rose', 'Hat Trick Hero', 'Jumbo Joker', 'Jungle Stripes', 'Lava Gold', 'Legend of the Nile', 'Lucky Seven', 'Madder Scientist', 'Mystic Hive', 'Puppy Love Plus', 'Quest to the West', 'Safari Sam', 'Spinfinity Man', 'Stay Frosty', 'Super Sweets', 'Sugar Pop', 'Sugar Pop 2', 'Take Olympus', "Take Santa's Shop", 'Take the Bank', 'Take the Kingdom', 'Take The Shot', 'The Angler', 'The Exterminator', 'The Hive', 'The True Sheriff', 'Thai Blossoms', 'Thor of Asgard', 'Threefold the Gold', 'Viking Voyage', 'Woodlanders', 'Yak, Yeti and Roll']],
  ['Bgaming', ['Adventures', 'All-Star Fruits', 'Aztec Clusters', 'Balloon Mania', 'Book of Pyramids', 'Brave Viking', 'Burning Chilli X', 'Domnitors', 'Domnitors Deluxe', 'Easter Plinko', 'Foxy Wild Heart', 'Fire Lightning', 'Football Plinko', 'Fortune Bells', 'Fruit Million', 'Gemhalla', 'GEMZA', 'Gift X', 'Heads and Tails', 'Heads and Tails XY', 'Hit the Route', "Kraken's Hunger", 'Limbo XY', 'Lucky Ducky', 'Lucky Pinball', 'Lucky Lady Moon', "Lucky Lady's Clover", 'LUCKY 8 MERGE UP', 'Maneki 88 Fortunes', 'Maneki 88 Gold', 'Merge Up', 'Mice and Magic', 'Mine Gems', 'Minesweeper XY', 'Miss Cherry Wild Frames', 'Plinko', 'Plinko 2', 'Plinko XY', 'Princess Royal', 'Retro Trader', 'Rocket Dice XY', 'Rotating Element', 'Royal Fruits Multilines', 'Savage Buffalo Spirit', 'Scroll of Adventure', 'Slot Machine', 'Slotomon Go', 'Space XY', 'Street Power', 'Super Sweets', 'Tile Master', 'Top Eagle', 'Tramp Day', 'WBC Ring Of Riches', 'Wild Card Gang', 'Wild Chicago', 'Wild Heart', 'Wild Tiger', 'Winter Fishing Club']],
  ['Big Time Gaming', ['Holy Diver', 'Holy Diver Megaways', 'White Rabbit']],
  ['Booongo', ["God's Temple Deluxe"]],
  ['Booming Games', ['Billy Bob Boom']],
  ['Blueprint', ['Bankin More Bacon', 'Big Catch even bigger bass', 'Big Catch even bigger bass 2', 'Bounty Hunter Unchained', 'Buffalo Rising Megaways VIP', 'Classic Fantastic', 'Diamond Mine Extra Gold VIP', 'Funky Buddha', 'Fortunes of Ra', 'Fortunes of Sparta', 'Gorilla Gold Megaways: Power 4 slots', 'Hope Diamond', 'King Kong Cash Even Bigger Bananas Megaways', 'Lotus Love', 'Majestic Fury', 'Saint Nicked', 'Stickermania Wild Rumble', 'Super Duper', 'The G.O.A.T']],
  ['Caleta', ['Banana Boom', 'BetMan Crash', 'Bingolaco', 'Crash Crash', 'Dragon Rising', 'Fate of Olympus', 'Hi-Loaf', 'Mine Medal', 'Princess of the Ocean', 'Torch of Fire', 'Trial of the Gods', 'Whale Bingo', 'World Wild Cup']],
  ['CQ9', ['Hero Fishing', 'Oneshot Fishing']],
  ['Degen', ['Penalty Pro']],
  ['Endorphina', ['All games']],
  ['Evolution', ['Evolution Live Benelux Slingshot (Auto-Roulette La Partage)', 'Fan Tan']],
  ['Fantasma', ['Gold Pigger 2 Royal Snouts']],
  ['Foxium', ['Astro Legends: Lyra and Erion', 'Vampire: The Masquerade - Las Vegas']],
  ['Gameart', ['Diamond Magic', 'Great Buffalo Megaways', 'Lucky Loser', 'Midgards Fortune Megaways', 'Plinko', 'Yellow Diver']],
  ['Gameburger', ['11 Champions']],
  ['Gamzix', ['3x5 Royal Piggy: Hold The Spin', '3x5 Patrick: Hold The Spin', 'Only Diamonds', 'Coin Win 2: Hold The Spin', 'Only Coins Express', 'Only Coins', 'Tiger Pot: Hold The Spin', 'Aviajet', 'Pilot', 'Pilot Cup', 'Redjet']],
  ['Golden Hero', ['Monster Domination']],
  ['Golden Race', ['Golden Race']],
  ['Habanero', ['Atomic Kittens', 'Before Time Runs Out', 'Bomb Runner', 'Calaveras Explosivas', 'Cake Valley', 'Candy Tower', 'Crystopia', 'Disco Beats', 'Dragon Tiger Gate', 'Fist of Gold', 'Flying High', 'Fortune Dogs', 'Golden Unicorn Deluxe', 'Jellyfish Flow', 'Jellyfish Flow Ultra', 'Knockout Football Rush', 'Laughing Buddha', 'Legend of Nezha', 'London Hunter', 'Loony Blox', 'Lucky Durian', 'Magic Oak', 'Mighty Medusa', 'Naughty Wukong', "New Year's Bash", 'Nine Tails', 'Orbs of Atlantis', 'Rainbow Mania', 'Return to the Feature', 'Rolling Roger', "Santa's Village", 'Scopa', 'Skys the Limit', 'Soju Bomb', 'The Big Deal Deluxe', 'Tooty Fruity Fruits', 'Tuk Tuk Thailand', 'Valentine Mochy', 'Witches Tome', 'Wizards Want War', 'Zeus Deluxe']],
  ['Hacksaw', ['Blocks', 'Boxes Dare2Win', 'Coins Dare2Win', 'Colors', 'Hi-Lo', 'Lines', 'Limbo', 'Mines Dare2Win', 'Plinko Dare2Win', 'Speed Crash', 'Wheel']],
  ['JDB Gaming', ['Birds Party', 'Birds Party Deluxe', 'Caishen Fishing', 'Chef Panda', 'Dragon Fishing', 'Dragon Fishing 2', 'Dragon Master', 'Dragons Gate', 'Fighter Fire', 'Firework Burst', 'Fishing Yilufa', 'Fortune Neko', 'Galaxy Burst', 'Goal', 'Lantern Wealth', 'Miner Babe', 'Orient Animals', 'Shade Dragons Fishing', 'Winning Mask II']],
  ['JFTW', ['Mr. Pigg E. Bank', 'Scarab Kingdom', 'Trojan Kingdom']],
  ['Jili', ['All-star Fishing', 'Bombing Fishing', 'Fish Prawn Crab', 'Happy Fishing', 'Jackpot Fishing', 'Mega Fishing', 'Royal Fishing']],
  ['Kalamba', ['All games']],
  ['KingMidas', ['Cash Rocket', 'Elite Aviator Club', 'Heist', 'Interstellar Run', 'Iron Dome', 'Jackpot Jump', 'Mine Sweeper', 'Olympus Glory', 'Penguin Panic', 'Plinko', 'Toon Crash']],
  ['Microgaming', ['Beautiful Bones', 'Champions of Olympus', 'Couch Potato', 'FlyX', 'Goldaur Guardians', 'Lucky Riches Hyperspins', 'Magic of Sahara', 'Oni Hunter Plus', 'Peek-a-boo - 5 Reel', 'Rabbit in the Hat', 'Retro Reels - Extreme Heat', 'Scrooge', 'Stardust']],
  ['Nolimit City', ['Munchies', 'Outsourced: Slash Game', 'The Creepy Carnival']],
  ['Neon Valley', ['Age of Conquest']],
  ['Netent', ['Beach Invaders', 'Blood Suckers', 'Cornelius', 'Divine Fortune Black', 'Dragons Playground', 'Golden Egg Invaders', 'Hotline', 'Jack Hammer 2: Fishy Business', 'Jingle Bells Bonanza', 'Lost Relics 2', 'Mermaids', 'Mummy Megaways', 'Pirates Party', 'Rabid Randy', 'Rage of the Seas', 'Rome The Golden Age', 'Scudamores Super Stakes', 'Serengeti Kings', 'Steam Tower', 'Street Fighter 2 The World Warrior', 'Super Strike', 'The Wishmaster Megaways', 'Ticket to Wild', 'Touchdown Treasures', 'Wilderlandy', 'Wonders of Christmas']],
  ['Novomatic', ['One Mad Hatter']],
  ['Northern Lights', ['God of Fire', 'Tiki Boom']],
  ['Penguin King', ['Bass Smash', 'Bounty Smash', 'Caishen Smash', 'Flaming Frenzy', 'Gold Smash', 'Mole Smash', "Pip and Pippa's Pots of Plenty", 'Santa Smash', 'Sphere Smash', 'Sweet Smash']],
  ['OneTouch', ['Bonus Track', 'Cash Galaxy', 'Flexing Dragons', 'Fortune Minert', 'LaLiga Plinko', 'Loot or Boot', 'Miko Festival', 'Pawsome Plinko', 'Queens of Glory', 'Queens of Glory Legacy', 'Roulette', 'Roulette High Roller', 'Roulette Pro', 'Steam Vault', 'Wild Voodoo']],
  ['OnlyPlay', ['Coin Flynn Deluxe', 'CosmoX', 'CRICKET CRASH!', 'CricX', 'Crystal Cascade', 'F777 Fighter', 'GoalX', 'Inca Son', 'Juicy Crush', 'Juicy Crush Halloween', 'Limbo Cat 2', 'Lucky Punch', 'Myths of Bastet', 'Need For X', 'Piggy Tap', 'Quantum X', 'ScoreX', 'When Lambo']],
  ['Origami', ['All games']],
  ['PGSoft', ['All games']],
  ['PlaynGo', ['15 Crystal Roses: A Tale of Love', 'Bakers Treat', 'Boat Bonanza Rider', 'Bucking Rider', 'Cloud Quest', "Crabby's Gold", 'Cursed Moon Power Collection', 'Craps', 'Gemix', 'Gemix 2', 'Gunslinger Reloaded', 'HammerFall', 'Mahjong 88', 'Miner Donkey Rider', 'Pearls of India', 'Rage to Riches', 'Sea Hunter', 'Spark of Genius', 'Sweet Alchemy', 'Sweet Alchemy Bingo', 'Tower Quest', 'Tower Quest Legacy', 'Viking Runecraft', 'Viking Runecraft Bingo']],
  ['Pragmatic', ['888 Bonanza', 'Big Bass Crash', 'Bronco Spirit', "Caishen's Gold", 'Dragon Kingdom - Eyes of Fire', 'Gold Train', 'Golden Beauty', 'High Flyer', 'Jade Butterfly', 'Mahjong Wins', 'Pinup Girls', 'Snakes and Ladders Megadice', 'Spaceman', 'The Champions', 'Fu Fu Fu']],
  ['Push', ['Mad Cars', "Samurai's Katana", 'Shamrock Saints', 'Wild Swarm']],
  ['Red Tiger', ['All games']],
  ['Relax', ['5 Monsters', 'Beanstalk Grows Wild', 'Book of 99', 'Curse of Ra', 'Epic Joker', 'Hazakura Ways', 'Hellcatraz', 'Honey Hunters', 'Marching Legions', 'Mega Mine', 'Money Cart', 'Money Cart 2', 'Royal Potato', 'Shadow Summoner Elementals', 'Sultan Spins', 'Temple Tumble 2', 'Temple Rush']],
  ['Revolver', ['Irish Coins', 'Thor of Asgard']],
  ['Rogue', ['Happy Holidays', 'Happily Ever After', 'Lucky 8 Keno']],
  ['RubyPlay', ['Arabian Secret', "Bandido's Bang", 'Blazing Tiger', 'Book of 8 Riches', 'Christmas Fortune', 'Clovers of Luck', 'Clovers of Luck 2', 'Dragon Ladies', 'Grand Express Action Class', 'Grand Express Diamond Class', 'Grand Express Fiesta', 'Immortal Ways 88 Charms', 'Immortal Ways Buffalo', 'Immortal Ways Diamonds', 'Loco Habanero', 'Mayan Blaze', 'More Dragon Ladies', 'Mucho Loco Habanero', 'New Year Happiness', 'Prosperity Blessing', 'Prosperity Journey', 'Quest Of Gods', 'Savage Lion', 'Viking Crusade', 'Immortal Ways Volcano']],
  ['Skywind', ['Christmas Luck', 'Fish Cashpot Deluxe', 'Glucks Joker', 'Halloween Luck', "Joker's Luck", "Joker's Luck Deluxe", 'Triple Monkey']],
  ['Smartsoft', ['All games']],
  ['Snowborn Studios', ['Tippy Tavern']],
  ['Spinomenal', ['1 Reel games']],
  ['Spinplay Games', ['Diamond King Jackpots', 'Wolf Call']],
  ['Spribe', ['All games']],
  ['Split the Pot', ['Rugby Run']],
  ['Thunderkick', ['1429 Uncharted Seas', 'Barbershop Uncut', 'Bork the Berzerker', 'Fruit Warp', 'Toki Time']],
  ['Truelab', ['Crypts of Fortune', 'Mining Factory', 'Moooving Wilds', 'Startup Valley', 'Victoria Wild', 'Victoria Wild Deluxe']],
  ['Turbogames', ['All games']],
  ['VoltEnt', ['12 Coins Grand Diamond Edition', 'Hot Slot: 777 Cash Out Grand Diamond Edition', 'Sizzling Eggs Grand Platinum Edition', 'Sizzling Eggs Grand Gold Edition']],
  ['Wazdan', ['All games']],
  ['Winfast', ['All games']],
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
      <span>Bitcasino Reward Terms &amp; Conditions</span>
    </nav>
  );
}

function ExcludedGamesTable() {
  return (
    <div className="my-6 w-full overflow-x-auto">
      <table className="min-w-[520px] w-full border-separate border-spacing-y-2 text-left">
        <thead>
          <tr className="bg-gohan"><th className="w-1/3 px-3 py-3 font-bold">Provider</th><th className="px-3 py-3 font-bold">Game</th></tr>
        </thead>
        <tbody>
          {EXCLUDED_GAMES.map(([provider, games]) => (
            <tr key={provider} className="align-middle">
              <td className="bg-gohan px-3 py-3 font-medium">{provider}</td>
              <td className="bg-gohan px-3 py-3">{games.map((game) => <div key={game}>{game}</div>)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Article() {
  return (
    <article className="min-w-0 max-w-[800px] text-[15px] leading-6 text-bulma md:text-base md:leading-7">
      <div className="mb-8">
        <p className="mb-2 text-[10px] uppercase leading-4 tracking-[0.5px] text-trunks">Bitcasino Information</p>
        <h1 className="font-primary text-2xl font-bold leading-8 text-bulma">Bitcasino Reward Terms &amp; Conditions</h1>
      </div>
      <p>At Bitcasino, players can win rewards by participating in regular promotions and tournaments, activating Casino Boost, or being part of the Bitcasino Loyalty Club.</p>
      <p className="mt-4">All rewards come without wagering requirements. Bitcasino does not offer deposit or welcome rewards.</p>
      <p className="mt-4">Depending on the promotion or tournament, players can receive:</p>
      <ul className="my-4 list-disc space-y-1 ps-6 marker:text-piccolo">
        <li><strong>Free spins</strong> - free rounds on a game</li>
        <li><strong>Free chips</strong> - given specifically for table games</li>
        <li><strong>Cash rewards</strong> - cash added to a player's balance automatically</li>
      </ul>
      <p>Players can find available rewards and enable promo codes in the Rewards tab of their account. Bitcasino.io may change or cancel any promotion at its sole discretion.</p>

      <h2 className="mb-4 mt-10 text-xl font-bold leading-7 text-bulma">Reward money wagering</h2>
      <p>For reward money with wagering requirements, players must turn over the reward and its winnings a specified number of times before making a withdrawal.</p>
      <p className="mt-4">The wagering contribution depends on the game category:</p>
      <ul className="my-4 list-disc space-y-1 ps-6 marker:text-piccolo">
        <li>Slots: 100%</li><li>Live Game Shows: 20%</li><li>Live-dealer games: 10%</li><li>Table Games and RNG-based games: 10%</li><li>Bitcasino Originals: 10%</li>
      </ul>
      <p>Certain casino games are excluded from Loyalty and reward wagering:</p>
      <ExcludedGamesTable />

      <h2 className="mb-4 mt-10 text-xl font-bold leading-7 text-bulma">Bitcasino Loyalty Club</h2>
      <p>Players receive loyalty level points from real-money bets on the games they play. Different loyalty levels give milestone rewards tailored to the player's gameplay.</p>
      <p className="mt-4">To find out more, visit the <Link to="/profile/loyalty" className="underline hover:text-piccolo">Bitcasino Loyalty Club</Link>.</p>

      <h2 className="mb-4 mt-10 text-xl font-bold leading-7 text-bulma">Withdrawals</h2>
      <p>Withdrawals cannot be made when a player has an active reward. The reward must be completed, or the player may forfeit or cancel it from the Rewards tab.</p>

      <h2 className="mb-4 mt-10 text-xl font-bold leading-7 text-bulma">Reward abuse</h2>
      <p>Reward abuse includes breaching reward terms, opening multiple accounts to claim multiple rewards, or allowing another person to place bets on a player's account while a reward is active.</p>
      <p className="mt-4">Where there is reasonable suspicion or proof of reward abuse, Bitcasino.io may forfeit the reward and associated winnings, remove related funds, restrict products, exclude the player from future promotions, or terminate the account.</p>
      <p className="mt-4">Methods, techniques or software that give a player an edge over other players or the reward system are prohibited. Rewards are intended for non-professional entertainment purposes only.</p>
      <p className="mt-4">By enabling a reward or using reward funds for play, a player accepts these Terms and Conditions, the promotional material requirements, and the General Terms and Conditions.</p>
    </article>
  );
}

export function RewardTerms() {
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
