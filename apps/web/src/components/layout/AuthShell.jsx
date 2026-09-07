import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Logo } from './Logo';
import { cn } from '@/lib/cn';

/**
 * The shell both auth screens share — `/login` and `/register`.
 *
 * The reference drops the whole app shell on these two: no sidebar, no header,
 * no footer. It splits the viewport instead — a fixed 380px form panel on the
 * start side that scrolls on its own, and the rest of the width given to a
 * dark marketing panel that disappears below `md`, leaving the form full
 * width. That is the entire responsive story; there is no middle state.
 *
 * Measured off the reference at 1500px, and identical on both screens:
 *
 * | | |
 * | --- | --- |
 * | Form panel | `w-[380px]`, `p-5`, own scroll → 340px content column |
 * | Rhythm | 48px logo→heading, 24px between blocks, 8px within the form |
 * | Provider row | `1fr 1fr auto` at 4px — 146 / 146 / 40, all 40px tall |
 * | Fields | 40px, `rounded-i-sm`, label carries the 8px as its own `pb-2` |
 * | Marketing | `#0F0025` under two 290px-blurred colour orbs |
 *
 * Only the heading, the form, the block of links under it and the marketing
 * copy and artwork change between the two screens — the rest comes from here.
 *
 * Assets and copy are the reference's own, served from `/images/auth/`.
 */

/** The two providers that get their own button; the rest live behind the `+`. */
const PROVIDERS = [
  { label: 'Metamask', icon: '/images/auth/metamask.svg' },
  { label: 'Google', icon: '/images/auth/google.svg' },
];

const MORE_PROVIDERS = ['Twitter', 'Line', 'Telegram', 'Apple'];

/**
 * The reference fills these with `beerus` rather than the lighter `gohan` our
 * `secondary` variant uses in the header — a heavier secondary, because on
 * this panel they are the primary path and the password form is the fallback.
 */
const PROVIDER_BUTTON = 'border-beerus bg-beerus text-base hover:bg-hit active:bg-beerus';

/** Shared focus treatment: brand border plus a 3px brand ring at half alpha. */
const FOCUS = 'focus-visible:border-piccolo focus-visible:ring-[3px] focus-visible:ring-piccolo/50';

/** Text field. 1.6px `hit` hairline on nothing, so the panel shows through. */
export const AUTH_INPUT = cn(
  'h-10 w-full min-w-0 rounded-i-sm border-[1.6px] border-hit bg-transparent',
  'px-2.5 py-1 text-base text-bulma transition-colors outline-none placeholder:text-trunks',
  FOCUS,
);

/** Select. A filled control on the reference — `gohan` behind a 0.8px border. */
export const AUTH_SELECT = cn(
  'h-10 w-full min-w-0 cursor-pointer rounded-i-sm border-[0.8px] border-beerus bg-gohan',
  'px-2 text-base text-trunks transition-colors outline-none hover:border-trunks',
  FOCUS,
);

/**
 * Field label. The 8px under it is the label's own padding, which is what
 * makes each label/control pair a single row of the form's `gap-2` grid.
 * Inside a sub-grid that already has a row gap, pass `inGrid` to drop it.
 */
export function AuthLabel({ htmlFor, children, inGrid }) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn('block text-base leading-6 text-trunks', !inGrid && 'pb-2')}
    >
      {children}
    </label>
  );
}

/** Label over control as one grid row — the shape most of both forms is made of. */
export function AuthField({ id, label, type = 'text', value, onChange, autoComplete }) {
  return (
    <div>
      <AuthLabel htmlFor={id}>{label}</AuthLabel>
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        className={AUTH_INPUT}
      />
    </div>
  );
}

/**
 * 16px box, 4px radius, hairline `trunks` border, brand fill when on. The tick
 * is driven off the `checked` prop rather than `:checked`, since the mark
 * lives inside the box and so cannot be a `peer-` sibling of the input.
 *
 * `min-h-6` is what makes a one-line row 24px tall; a two-line one grows to 32
 * and `items-center` puts the box where the reference has it, straddling the
 * two lines rather than pinned to the first.
 */
export function AuthCheckbox({ name, checked, onChange, children }) {
  return (
    <label className="flex min-h-6 items-center gap-2 text-xs leading-4 text-bulma select-none">
      <input
        type="checkbox"
        name={name}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        className={cn(
          'grid size-4 shrink-0 place-items-center rounded-i-xs border-[0.8px]',
          'transition-colors peer-focus-visible:ring-[3px] peer-focus-visible:ring-piccolo/50',
          checked ? 'border-piccolo bg-piccolo text-goten' : 'border-trunks bg-goku/30',
        )}
      >
        {checked && <Icon name="check" size={12} strokeWidth={3} />}
      </span>
      {children}
    </label>
  );
}

/** The reCAPTCHA notice both panels close with. */
export function RecaptchaNotice() {
  return (
    <p className="text-xs leading-4 text-trunks">
      This site is protected by reCAPTCHA and the Google{' '}
      <a
        href="https://policies.google.com/privacy"
        target="_blank"
        rel="noreferrer"
        className="underline-offset-2 hover:underline"
      >
        Privacy Policy
      </a>{' '}
      and{' '}
      <a
        href="https://policies.google.com/terms"
        target="_blank"
        rel="noreferrer"
        className="underline-offset-2 hover:underline"
      >
        Terms of Service
      </a>{' '}
      apply.
    </p>
  );
}

/** The `+` at the end of the provider row, and the menu it opens. */
function MoreProviders() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => event.key === 'Escape' && setOpen(false);

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <Button
        variant="secondary"
        onClick={() => setOpen((value) => !value)}
        aria-label="More ways to sign in"
        aria-expanded={open}
        className={cn(PROVIDER_BUTTON, 'w-10 border-beerus bg-gohan px-0 hover:bg-beerus')}
      >
        <Icon name="plus" size={20} />
      </Button>

      {open && (
        <ul
          className={cn(
            'absolute end-0 top-[calc(100%+8px)] z-10 w-72 overflow-hidden',
            'rounded-i-sm border-[0.8px] border-beerus bg-goku py-2 shadow-lg',
          )}
        >
          {MORE_PROVIDERS.map((label) => (
            <li key={label}>
              <button
                type="button"
                className="flex h-10 w-full items-center px-4 text-start text-base text-bulma transition-colors hover:bg-heles"
              >
                {label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The right half: a near-black ground with two enormous blurred circles
 * bleeding in from opposite corners, a gold line pattern over the top, then
 * the artwork, headline and three benefits. That orb pair is the whole
 * gradient — no image, no `background-image`, which is how the reference does
 * it and why the colour holds up at any panel width.
 */
function MarketingPanel({ image, title, benefits }) {
  return (
    <div className="relative hidden grow overflow-hidden bg-[#0F0025] md:block">
      <div className="absolute -bottom-[260px] -left-[250px] size-[786px] rounded-full bg-[#FF2D00] blur-[290px]" />
      <div className="absolute -top-[206px] -right-[150px] size-[750px] rounded-full bg-[#20D4C1] blur-[290px]" />

      <img
        src="/images/auth/pattern.png"
        alt=""
        className="absolute top-0 right-0 block h-auto w-full"
      />

      {/* 45rem is the reference's content width, and it is what the artwork's
          70% resolves against — 504px. Sized off the panel instead, the art
          comes out half again too big and shoves the copy off the screen. */}
      <div className="relative grid h-full content-center justify-items-center p-8 text-goten">
        <div className="w-[45rem] max-w-full">
          <img
            src={image}
            alt=""
            className="mx-auto my-8 block h-[13.25rem] w-auto max-w-[45.75rem] min-[1400px]:h-auto min-[1400px]:w-[70%]"
          />

          <h2 className="mb-5 text-center font-secondary text-[48px] leading-[56px] font-light">
            {title}
          </h2>

          <ul className="grid justify-center gap-3 xl:grid-flow-col">
            {benefits.map((benefit) => (
              <li
                key={benefit.title}
                className="grid max-w-[14.5rem] grid-flow-col items-start gap-[0.4rem]"
              >
                <img src={benefit.icon} alt="" className="block h-auto w-10 self-start" />
                <div className="grid gap-2">
                  <h3 className="font-secondary text-[18px] leading-7 font-light">
                    {benefit.title}
                  </h3>
                  <p className="text-xs leading-4 text-[#E3E3E3]">{benefit.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/**
 * Props: `heading` (the h1), `image`, `title` and `benefits` for the marketing
 * panel, `children` for the form, `footer` for the block of links under it.
 */
export function AuthShell({ heading, image, title, benefits, footer, children }) {
  return (
    <div className="flex h-dvh overflow-hidden bg-goku">
      <div className="no-scrollbar h-full w-full overflow-y-auto bg-goku p-4 md:w-[380px] md:shrink-0 md:p-5">
        <div className="grid gap-6">
          <div className="grid content-start gap-6">
            {/* 48px between the mark and the heading — the largest gap on the
                panel, and the only thing separating them. */}
            <div className="grid gap-12">
              <Link to="/" aria-label="Home" className="flex h-8 justify-self-start">
                <Logo className="[&>svg]:w-[130px]" />
              </Link>
              <h1 className="font-secondary text-base leading-6 font-normal text-bulma">
                {heading}
              </h1>
            </div>

            {/* 1fr 1fr auto: two named providers, then the overflow button. */}
            <div className="grid w-full grid-flow-col grid-cols-2 gap-1">
              {PROVIDERS.map((provider) => (
                <Button key={provider.label} variant="secondary" className={PROVIDER_BUTTON}>
                  <img src={provider.icon} alt="" width={20} height={20} className="size-5 shrink-0" />
                  {provider.label}
                </Button>
              ))}
              <MoreProviders />
            </div>

            <div className="grid grid-flow-col grid-cols-[1fr_auto_1fr] items-center gap-2">
              <hr className="h-px border-0 bg-beerus" />
              <span className="text-[10px] leading-[15px] tracking-[1px] text-trunks uppercase">
                or
              </span>
              <hr className="h-px border-0 bg-beerus" />
            </div>

            {children}
          </div>

          {footer}
        </div>
      </div>

      <MarketingPanel image={image} title={title} benefits={benefits} />
    </div>
  );
}
