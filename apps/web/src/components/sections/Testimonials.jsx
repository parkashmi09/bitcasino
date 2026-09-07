import { Rail } from './Rail';
import { TESTIMONIALS } from '@/data/catalog';

/**
 * Review row, the last content block before the footer.
 *
 * Measured off the reference: a 256px-tall card, 288px wide below `md` and
 * 320px from it, on a `gohan` surface with a quote mark inset at the top-left.
 * Title clamps to two lines and the body to five, so a long review and a short
 * one produce the same card — that is what keeps the row reading as one band.
 * The star row is pinned to the bottom-left rather than flowing after the text,
 * so it sits on the same baseline across the whole rail.
 *
 * Quotes are written for this project, not collected from real players.
 */

const STARS = [1, 2, 3, 4, 5];

function Testimonial({ item }) {
  return (
    <figure className="relative h-64 w-72 rounded-lg bg-gohan px-5 pt-13 pb-5 md:w-80">
      <img
        src="/images/ui/quotes.svg"
        alt=""
        width={24}
        height={24}
        loading="lazy"
        decoding="async"
        className="absolute start-4 top-4 size-6"
      />

      <p className="m-0 mb-3 line-clamp-2 max-h-12 text-lg font-semibold text-bulma">
        {item.title}
      </p>

      <blockquote className="m-0 line-clamp-5 max-h-24 text-sm font-normal text-trunks">
        {item.quote}
      </blockquote>

      <figcaption className="absolute bottom-4 start-4 m-0 leading-none">
        <span className="sr-only">
          {item.author} rated this {item.rating} out of 5
        </span>
        <span aria-hidden="true">
          {STARS.map((star) => (
            <span
              key={star}
              className={
                star <= item.rating
                  ? 'mr-0.5 inline-block text-base leading-none text-krillin'
                  : 'mr-0.5 inline-block text-base leading-none text-beerus'
              }
            >
              ★
            </span>
          ))}
        </span>
      </figcaption>
    </figure>
  );
}

export function Testimonials() {
  return (
    <Rail title="Testimonials" href="/testimonials">
      {TESTIMONIALS.map((item) => (
        <Testimonial key={item.id} item={item} />
      ))}
    </Rail>
  );
}
