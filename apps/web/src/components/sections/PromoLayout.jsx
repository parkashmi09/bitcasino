import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { PROMOTIONS } from '@/data/catalog';
import { PROMO_PAGES } from '@/data/promotionPages';
import { cn } from '@/lib/cn';

/**
 * The chrome every promotion detail page shares, measured off the reference's
 * own `/promotions/<slug>` at 1536px.
 *
 * | | |
 * | --- | --- |
 * | Row | `grid grid-flow-col justify-between` inside the page's gutter |
 * | Article | `grid max-w-[700px]`, hero first, then `gap-10 pt-4` |
 * | Hero | 700x290, `rounded` (4px), one `<img>` |
 * | Title | 24px medium `bulma`, the body immediately under it |
 * | Section headings | 20px semibold, centred, with their blurb centred too |
 * | Tables | `display: table` divs — `piccolo` header, 1px rules, centred |
 * | Fine print | one `gohan` card, clipped to 192px with a fade and `Show more` |
 * | Aside | `mt-10 ml-24 p-6 max-w-[394px] rounded border border-beerus` |
 *
 * It lives here rather than in either page because the second page to need it
 * is what proves it is a layout and not one page's markup: `League` and
 * `WeeklyRakeback` differ in their body and in nothing else, exactly as the
 * reference's own two differ.
 *
 * Three departures from the reference, each deliberate:
 *
 * 1. **The tables are `<table>`s.** The reference ships `display: table` divs
 *    out of its CMS, which is what you do when your authoring tool will not
 *    let you write `<thead>`. Nothing renders differently and a screen reader
 *    gets a table it can navigate, so this uses the real element.
 * 2. **The row stacks below `lg`.** The reference's own row is `grid-flow-col`
 *    at every width with nothing responsive on it, and its aside is a fixed
 *    394px — two columns a 390px phone cannot hold. `docs/11` is explicit that
 *    a layout which only works on a desktop is not a reproduction of one that
 *    works, so the aside drops under the article and goes full width.
 * 3. **The hero is a top-anchored crop.** Both campaigns' artwork is the
 *    square lobby crop, whose whole subject sits in the top 40% above a band
 *    of empty gradient — the reference serves a second, wider render of the
 *    same picture for the hero, and cropping the one already in the tree beats
 *    carrying both. A centred crop would frame the gradient.
 */
export function PromoPage({ promo, children }) {
  return (
    <div className="grid gap-10 py-2 lg:grid-flow-col lg:justify-between lg:py-0">
      <article className="grid max-w-[700px] auto-rows-max">
        <img
          src={promo.art}
          alt=""
          width={700}
          height={290}
          className="block aspect-[700/290] w-full rounded object-cover object-top"
        />

        <div className="grid auto-rows-max gap-10 pt-4">
          <h1 className="text-2xl leading-8 font-medium text-bulma">{promo.title}</h1>
          {children}
        </div>

        <Breadcrumb items={[{ label: 'Promotions', to: '/promotions' }, { label: promo.title }]} />
      </article>

      <OtherPromotions slug={promo.slug} />
    </div>
  );
}

/**
 * One block of a promotion's body: a centred heading, an optional centred
 * blurb, then whatever the block is made of.
 *
 * `heading` is optional because the first block of every one of these pages is
 * the intro, which runs straight on from the title.
 */
export function PromoSection({ heading, blurb, children }) {
  return (
    <section>
      {heading && (
        <h2 className="text-center text-xl leading-7 font-semibold text-bulma">{heading}</h2>
      )}
      {blurb && <p className="my-4 text-center text-base leading-6 text-bulma">{blurb}</p>}
      {children}
    </section>
  );
}

/**
 * A body paragraph, with the reference's bold lead-in.
 *
 * `block` sets the lead on its own line instead of running the sentence on
 * from it, which is how the reference sets some of them and not others.
 */
export function PromoParagraph({ lead, block, italic, children }) {
  // `first:mt-0` because the block's own 40px gap already separates it from
  // whatever is above; without it the first paragraph of a section sits 56px
  // below the heading where the reference has 30.
  return (
    <p className={cn('my-4 text-base leading-6 text-bulma first:mt-0', italic && 'italic')}>
      {lead && (
        <>
          <strong className="font-bold">{lead}</strong>
          {block ? <br /> : ' '}
        </>
      )}
      {children}
    </p>
  );
}

/**
 * The three numbered cards the reference calls "Here's the play".
 *
 * `steps` is `[{title, text}]`. The reference serves the discs as one CMS
 * image per number; a disc with a numeral in it is not an illustration, so
 * drawing it here keeps it on the brand colour and lets it scale with the
 * text rather than shipping three PNGs.
 */
export function PromoSteps({ steps }) {
  return (
    <ol className="mt-8 grid gap-3 md:grid-cols-3">
      {steps.map((step, index) => (
        <li key={step.title} className="text-center">
          <span
            aria-hidden="true"
            className="mx-auto grid size-[50px] place-items-center rounded-full bg-piccolo font-secondary text-xl font-bold text-goten"
          >
            {index + 1}
          </span>
          <h3 className="mt-4 text-base font-bold text-bulma">{step.title}</h3>
          <p className="mt-1 text-base leading-6 text-bulma">{step.text}</p>
        </li>
      ))}
    </ol>
  );
}

/**
 * One of a promotion's tables.
 *
 * `overflow-x-auto` on the wrapper and a `min-w` on the table: a four-column
 * board needs about 380px before the headings start wrapping to three lines
 * each. Everything wider gets the reference's percentage columns, which is
 * what `<colgroup>` carries.
 */
export function PromoTable({ columns, widths, children }) {
  return (
    <div className="my-6 overflow-x-auto">
      <table className="w-full min-w-[380px] border-collapse text-base">
        <colgroup>
          {widths.map((width, index) => (
            <col key={columns[index]} style={{ width }} />
          ))}
        </colgroup>

        {/* `bulma` on `piccolo`, which is what the reference renders rather
            than what its own stylesheet asks for: the CMS wrapper's
            `[&_div]:text-bulma` beats the `.lb-header { color: #fff }` inside
            it. It is also the better of the two — black on the brand orange is
            5.9:1 against white's 3.5:1 — so this follows the pixels. */}
        <thead>
          <tr className="bg-piccolo text-bulma">
            {columns.map((column) => (
              <th key={column} className="px-2.5 py-2 text-center font-bold">
                {column}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function PromoCell({ className, children }) {
  return (
    <td className={cn('border-b border-beerus px-2.5 py-2 text-center text-bulma', className)}>
      {children}
    </td>
  );
}

/**
 * Everything the reference folds into one collapsed card at the foot of a
 * promotion: how the mechanic works, then the terms.
 *
 * `blocks` is `[{id, heading, paragraphs?, bullets?, footnote?, items?}]` —
 * `paragraphs` prose, `bullets` a disc list, `items` a numbered one, which is
 * how the reference sets each kind.
 *
 * The clip is a `max-height` rather than an unmount, so the text is in the DOM
 * for find-in-page and for a screen reader following `aria-controls`; the
 * gradient is the reference's own `::after`, `gohan` to transparent, and it is
 * `pointer-events-none` so it never eats a click on the text under it.
 */
export function PromoFinePrint({ blocks }) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <section className="rounded-s-xs bg-gohan px-4 py-2 sm:p-8 sm:pb-5">
      <div
        id={id}
        className={cn(
          'relative',
          !open &&
            'max-h-48 overflow-hidden after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-24 after:bg-gradient-to-t after:from-gohan after:to-transparent',
        )}
      >
        {blocks.map((block) => (
          <div key={block.id}>
            <h2 className="mt-6 mb-3 text-xl leading-7 font-medium text-bulma first:mt-0">
              {block.heading}
            </h2>

            {block.paragraphs?.map((text) => (
              <p key={text} className="my-4 text-base leading-6 text-bulma">
                {text}
              </p>
            ))}

            {block.bullets && (
              <ul className="my-4 list-disc ps-10 text-base leading-6 text-bulma marker:text-piccolo">
                {block.bullets.map((bullet) => (
                  <li key={bullet.lead}>
                    <strong className="font-bold">{bullet.lead}</strong> {bullet.text}
                  </li>
                ))}
              </ul>
            )}

            {block.footnote && (
              <p className="my-4 text-base leading-6 text-bulma">{block.footnote}</p>
            )}

            {block.items && (
              <ol className="my-4 list-decimal ps-10 text-base leading-6 text-bulma">
                {block.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            )}
          </div>
        ))}
      </div>

      <div className="flex justify-center pt-4">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={id}
          className="h-10 cursor-pointer rounded-i-sm bg-hit px-4 text-base text-bulma transition-transform duration-200 active:scale-90"
        >
          {open ? 'Show less' : 'Show more'}
        </button>
      </div>
    </section>
  );
}

/**
 * The rail beside the article.
 *
 * The reference lists two other campaigns it is running. This lists the app's
 * other promotion PAGES first and tops up from `PROMOTIONS` — so the rail
 * always leads with somewhere that has a page behind it, and never advertises
 * the page it is sitting on.
 */
function OtherPromotions({ slug }) {
  const others = [...PROMO_PAGES, ...PROMOTIONS]
    .filter((promo) => promo.slug !== slug)
    .slice(0, 2);

  return (
    <aside className="h-fit max-w-[394px] rounded border border-beerus p-6 lg:mt-10 lg:ml-24">
      <h2 className="text-xl font-semibold text-bulma">Other promotions</h2>

      <div className="mt-5 grid gap-5">
        {others.map((promo) => (
          <Link key={promo.href} to={promo.href} className="group grid gap-1">
            <img
              src={promo.art}
              alt=""
              width={343}
              height={142}
              className="block aspect-[343/142] w-full rounded object-cover object-top"
            />
            <h3 className="text-lg font-medium text-bulma group-hover:text-piccolo">
              {promo.title}
            </h3>
          </Link>
        ))}
      </div>

      {/* 10px uppercase, and floated right on the reference. A flex row does
          the same thing without taking the link out of flow. */}
      <div className="mt-6 flex justify-end">
        <Link
          to="/promotions"
          className="text-[0.625rem] font-semibold text-bulma uppercase hover:text-piccolo"
        >
          See all promotions
        </Link>
      </div>
    </aside>
  );
}
