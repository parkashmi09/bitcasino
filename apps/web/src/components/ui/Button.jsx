import { cn } from '@/lib/cn';

/* Every button on the reference carries a 0.8px border — transparent where
   there is nothing to draw — so a filled and an outlined button of the same
   size occupy the same box. */
const VARIANTS = {
  primary:
    'border-[0.8px] border-transparent bg-piccolo text-goten hover:bg-piccolo-80 active:bg-piccolo-120 shadow-sm',
  secondary:
    'border-[0.8px] border-hit bg-gohan text-bulma hover:bg-beerus active:bg-hit',
  ghost:
    'border-[0.8px] border-transparent bg-transparent text-bulma hover:bg-heles',
  outline:
    'border-[0.8px] border-beerus bg-transparent text-bulma hover:bg-heles',
};

/**
 * Heights track the reference site: 44px for header actions, 58px for the
 * hero call to action, all on the 8px corner radius the whole UI uses.
 */
const SIZES = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-i-sm',
  md: 'h-10 px-4 text-sm gap-2 rounded-i-sm',
  lg: 'h-11 px-4 text-sm gap-2 rounded-i-sm',
  xl: 'h-[58px] px-7 text-base gap-2 rounded-i-sm',
};

/**
 * Props: `variant` (a key of VARIANTS), `size` (a key of SIZES), `fullWidth`,
 * `as` to render something other than a `button` — a `Link`, say, for an
 * action that is really navigation — plus any attribute of whatever it
 * renders, which is spread onto the element.
 */
export function Button({
  as: Component = 'button',
  variant = 'primary',
  size = 'md',
  fullWidth,
  className,
  type = 'button',
  ...props
}) {
  return (
    <Component
      type={Component === 'button' ? type : undefined}
      className={cn(
        'inline-flex items-center justify-center font-medium whitespace-nowrap',
        'transition-colors duration-150 cursor-pointer select-none',
        'disabled:opacity-50 disabled:pointer-events-none',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    />
  );
}
