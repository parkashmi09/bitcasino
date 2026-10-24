import {
  PromoCell,
  PromoFinePrint,
  PromoPage,
  PromoParagraph,
  PromoSection,
  PromoSteps,
  PromoTable,
} from '@/components/sections/PromoLayout';
import {
  LEAGUE,
  LEAGUE_BOARD,
  LEAGUE_FINE_PRINT,
  LEAGUE_INTRO,
  LEAGUE_MULTIPLIERS,
  LEAGUE_PLAYERS,
  LEAGUE_PRIZES,
  LEAGUE_STEPS,
  leagueUpdatedAt,
} from '@/data/league';

/**
 * `/promotions/league-of-bitcasino` — the campaign the home banner's first card
 * has always advertised and never reached.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE BANNER POINTED AT A REDIRECT, NOT AT A PAGE.
 *
 * `HOME_BANNERS[0].href` was `/promotions/league`, and `App.jsx` sends every
 * `promotions/:slug` to `/promotions` because no campaign has a page. So the
 * League card — the one with the League artwork, the League title and a blurb
 * about a four-week race — landed on the spin wheel and a bonus log. This page
 * is that destination, and the banner (plus the sidebar's League card, which
 * had the same problem) now points at it by the reference's own slug.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * The page's chrome — hero, title, centred section headings, tables, the
 * collapsed fine-print card, the breadcrumb and the `Other promotions` rail —
 * is `PromoLayout`, which carries the measurements off the reference. What is
 * here is this campaign's body and nothing else.
 */
export function League() {
  return (
    <PromoPage promo={LEAGUE}>
      <Intro />
      <Steps />
      <Multipliers />
      <Prizes />
      <Board />
      <PromoFinePrint blocks={LEAGUE_FINE_PRINT} />
    </PromoPage>
  );
}

/**
 * Title, lede and body.
 *
 * The reference sets the title at the same 16px as the prose under it — it is
 * a strapline, not a heading step — so this is `text-base`, and the size is
 * not a transcription slip.
 */
function Intro() {
  return (
    <section className="text-base leading-6 text-bulma">
      <h2 className="font-normal">{LEAGUE_INTRO.title}</h2>
      <PromoParagraph>{LEAGUE_INTRO.lede}</PromoParagraph>

      {LEAGUE_INTRO.paragraphs.map((paragraph) => (
        <PromoParagraph key={paragraph.lead} lead={paragraph.lead} block={paragraph.block}>
          {paragraph.text}
        </PromoParagraph>
      ))}

      <PromoParagraph italic>{LEAGUE_INTRO.postscript}</PromoParagraph>
    </section>
  );
}

function Steps() {
  return (
    <PromoSection heading="Here's the play:">
      <PromoSteps steps={LEAGUE_STEPS} />
    </PromoSection>
  );
}

function Multipliers() {
  return (
    <PromoSection
      heading="What this final week's play is worth"
      blurb={`Based on how many of the three categories you are active in during Week ${LEAGUE.week}. A category counts once you have wagered 1,000 USDT or more in it during the week.`}
    >
      <PromoTable columns={['Categories covered', 'Multiplier']} widths={['50%', '50%']}>
        {LEAGUE_MULTIPLIERS.map((row) => (
          <tr key={row.covered}>
            <PromoCell>{row.covered}</PromoCell>
            <PromoCell>{row.multiplier}</PromoCell>
          </tr>
        ))}
      </PromoTable>
    </PromoSection>
  );
}

function Prizes() {
  return (
    <PromoSection heading={`Week ${LEAGUE.week} Prize Pool: ${LEAGUE.weeklyPool}`}>
      <PromoTable columns={['Position', 'Prize (USDT)']} widths={['50%', '50%']}>
        {LEAGUE_PRIZES.map((row) => (
          <tr key={row.position}>
            <PromoCell>{row.position}</PromoCell>
            <PromoCell>{row.prize}</PromoCell>
          </tr>
        ))}
      </PromoTable>
    </PromoSection>
  );
}

/**
 * The top 100.
 *
 * `tabular-nums` on the three numeric columns — a hundred rows of proportional
 * figures make a ragged column of digits, and this is the one place on the
 * page with enough of them for it to show.
 */
function Board() {
  return (
    <PromoSection
      heading={`Week ${LEAGUE.week} Leaderboard`}
      blurb={`This is the final weekly round. Not in the top 100 yet? You're still in the race. Every qualifying wager is counted, and we're building a way for you to see your exact position soon.`}
    >
      <PromoTable
        columns={['Position', 'Username', 'Boost', 'Points']}
        widths={['16%', '38%', '20%', '26%']}
      >
        {LEAGUE_BOARD.map((row) => (
          <tr key={row.position}>
            <PromoCell className="tabular-nums">{row.position}</PromoCell>
            <PromoCell>{row.alias}</PromoCell>
            <PromoCell className="tabular-nums">{row.boost}</PromoCell>
            <PromoCell className="tabular-nums">{row.points.toLocaleString('en-US')}</PromoCell>
          </tr>
        ))}
      </PromoTable>

      <p className="text-center text-base text-bulma italic">
        Last updated on: {leagueUpdatedAt()}
        <br />
        Total Players: {LEAGUE_PLAYERS.toLocaleString('en-US')}
      </p>
    </PromoSection>
  );
}
