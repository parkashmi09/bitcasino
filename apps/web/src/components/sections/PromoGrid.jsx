import { Link } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { PROMOTIONS } from '@/data/catalog';
import { cn } from '@/lib/cn';

const TONE_BG = {
  brand: 'from-piccolo to-piccolo-120',
  jackpot: 'from-jackpot to-jackpot-2',
  positive: 'from-roshi to-whis',
};

export function PromoGrid() {
  return (
    <section className="py-6">
      <h2 className="mb-3 font-secondary text-xl font-light leading-8 text-bulma md:text-2xl">
        Promotions
      </h2>

      <ul className="grid gap-3 md:grid-cols-3">
        {PROMOTIONS.map((promo) => (
          <li key={promo.id}>
            <Link
              to={promo.href}
              className={cn(
                'group relative flex h-full min-h-40 flex-col justify-between overflow-hidden',
                'rounded-s-md bg-linear-135 p-5 text-goten',
                TONE_BG[promo.tone],
              )}
            >
              <div
                aria-hidden="true"
                className="absolute -end-8 -top-8 size-32 rounded-full bg-goten/10 transition-transform duration-300 group-hover:scale-125"
              />
              <div className="relative">
                <h3 className="font-secondary text-lg font-medium">{promo.title}</h3>
                <p className="mt-1.5 max-w-[24ch] text-xs leading-5 text-goten/85">
                  {promo.blurb}
                </p>
              </div>
              <span className="relative mt-4 inline-flex items-center gap-1 text-xs font-bold">
                {promo.cta}
                <Icon
                  name="chevron-right"
                  size={14}
                  className="transition-transform group-hover:translate-x-0.5"
                />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
