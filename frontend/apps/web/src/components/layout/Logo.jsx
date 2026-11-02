import { cn } from '@/lib/cn';
import { brandName } from '@/lib/branding';
import { useBranding } from '@/queries/siteConfig';

/**
 * The site's logo: the owner panel's uploaded logo / square mark when there is
 * one, else the common TestPlay artwork (public/brand/testplay-*.svg, shared
 * with smartbet), in the same 150x32 / 32x32 box. Light ink: the light theme
 * puts it on a dark chip (`.brand-logo` in styles/index.css).
 */
export function Logo({ className, markOnly = false }) {
  const branding = useBranding();
  const src = markOnly
    ? branding?.markUrl ?? branding?.logoUrl ?? '/brand/testplay-mark.svg'
    : branding?.logoUrl ?? '/brand/testplay-logo.svg';
  return (
    <span className={cn('inline-flex items-center gap-2 text-bulma', className)}>
      <img
        src={src}
        alt={brandName(branding)}
        className={cn(
          'h-8 w-auto object-contain',
          // The TestPlay art has light ink (dark chip in the light theme); an owner logo is drawn for a
          // light page (white chip in the dark theme). A square mark needs neither.
          markOnly ? 'max-w-8' : 'max-w-[150px]',
          !markOnly && (branding?.logoUrl ? 'owner-logo' : 'brand-logo'),
          markOnly && !branding?.markUrl && !branding?.logoUrl && 'brand-logo',
        )}
      />
    </span>
  );
}
