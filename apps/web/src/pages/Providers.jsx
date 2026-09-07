import { Link } from 'react-router-dom';
import { PROVIDERS } from '@/data/catalog';

export function Providers() {
  return (
    <div className="py-6">
      <h1 className="font-secondary text-xl font-light leading-8 text-bulma md:text-2xl">
        Software providers
      </h1>
      <p className="mt-1 text-sm text-trunks">
        {PROVIDERS.length} studios
      </p>

      <ul className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        {PROVIDERS.map((provider) => (
          <li key={provider.id}>
            <Link
              to={`/providers/${provider.slug}`}
              className="flex h-28 flex-col items-center justify-center gap-2 rounded-i-md bg-gohan px-3 transition-colors hover:bg-beerus"
            >
              <img
                src={provider.logo}
                alt={provider.name}
                loading="lazy"
                decoding="async"
                className="h-7 w-auto max-w-full object-contain"
              />
              <span className="text-center text-xs font-medium text-bulma">
                {provider.name}
              </span>
              <span className="text-[11px] text-trunks">
                {provider.gameCount} games
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
