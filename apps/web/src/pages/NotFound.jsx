import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div className="grid place-items-center py-24 text-center">
      <p className="font-secondary text-5xl font-bold text-piccolo">404</p>
      <h1 className="mt-3 font-secondary text-2xl font-normal text-bulma">
        This page took a wrong turn
      </h1>
      <p className="mt-2 max-w-sm text-sm text-trunks">
        The page you are looking for has moved or never existed.
      </p>
      <Link
        to="/"
        className="mt-6 inline-flex h-12 items-center justify-center rounded-i-md bg-piccolo px-6 text-base font-medium text-goten transition-colors hover:bg-piccolo-80 active:bg-piccolo-120"
      >
        Back to the lobby
      </Link>
    </div>
  );
}
