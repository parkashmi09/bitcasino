import { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { useRegion } from '@/queries/siteConfig';
import { SUPPORT_EMAIL } from '@/lib/site';

/**
 * The owner's region restriction, as the backend applies it to this visitor (`GET /user/region`).
 *
 *   notice  a dismissible dialog, once per browser session;
 *   block   the same dialog with no way out: sign-up and sign-in are refused server-side too.
 *
 * The IP, country and ray id are the visitor's own, for a support ticket. A failed check shows
 * nothing: an unreachable service never blocks anyone.
 */
const DISMISSED_KEY = 'bc.region.dismissed';

function readDismissed() {
  try {
    return sessionStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function RegionNotice() {
  const { data } = useRegion();
  const [dismissed, setDismissed] = useState(readDismissed);
  const block = data?.mode === 'block';

  if (!data?.restricted || (!block && dismissed)) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Private mode: closed for this page view only.
    }
    setDismissed(true);
  };

  return (
    <Dialog open onClose={dismiss} title="Region restricted" dismissible={!block}>
      <div className="grid justify-items-center gap-3 text-center">
        <span className="grid size-14 place-items-center rounded-full bg-gohan text-piccolo">
          <Icon name="globe" size={28} />
        </span>
        <p className="text-base leading-6 text-bulma">
          {block
            ? 'Our services are not available in your region.'
            : 'Our services may not be available in your region. Some features could be limited.'}
        </p>
        <dl className="grid w-full gap-1 rounded-i-sm bg-gohan px-3 py-2 text-start text-xs leading-5">
          {[
            ['IP address', data.ip],
            ['Region', data.areaCode],
            ['Ray ID', data.rayId],
          ]
            .filter(([, value]) => value)
            .map(([name, value]) => (
              <div key={name} className="flex justify-between gap-3">
                <dt className="text-trunks">{name}</dt>
                <dd className="truncate text-bulma tabular-nums">{value}</dd>
              </div>
            ))}
        </dl>
        {SUPPORT_EMAIL && (
          <p className="text-xs leading-5 text-trunks">
            Think this is a mistake? Write to {SUPPORT_EMAIL} with the Ray ID above.
          </p>
        )}
        {!block && (
          <Button fullWidth onClick={dismiss}>
            I understand
          </Button>
        )}
      </div>
    </Dialog>
  );
}
