import { useSiteName } from '@/queries/siteConfig';

/** The site's name in running copy: the owner panel's branded name, else this build's. */
export function Brand() {
  return useSiteName();
}
