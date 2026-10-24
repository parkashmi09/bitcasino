import { Link } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';

/**
 * A playable original, to a visitor who has no wallet to play it from.
 *
 * The panel itself is not shown disabled: every control on it would be inert
 * and the stake field would be asking about a balance that does not exist.
 */
export function SignInToPlay({ title }) {
  return (
    <div className="grid aspect-[9/16] w-full place-items-center overflow-hidden rounded-lg bg-goku px-6 text-center sm:aspect-video">
      <div>
        <span className="mx-auto grid size-16 place-items-center rounded-full bg-piccolo text-goten">
          <Icon name="play" size={28} className="ms-1" />
        </span>
        <p className="mt-4 font-secondary text-lg font-medium text-bulma">{title}</p>
        <p className="mt-1 text-xs text-trunks">Log in to play a round.</p>
        <Link
          to="/login"
          className="mt-4 inline-flex h-10 items-center rounded-i-sm bg-piccolo px-4 text-sm font-medium text-goten transition-opacity hover:opacity-90"
        >
          Log in
        </Link>
      </div>
    </div>
  );
}