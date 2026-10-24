import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';

/** The reference's `claim-header.png` banner, kept local like every asset. */
const CLAIM_HEADER = '/images/rewards/claim/claim-header.png';

/**
 * The reference's social strip under the form; each icon is its 32px PNG in
 * `public/images/rewards/claim/`, and the links are the reference's own.
 */
const SOCIAL = [
  { name: 'x.com', src: '/images/rewards/claim/x.png', href: 'https://twitter.com/Bitcasinoio' },
  { name: 'instagram', src: '/images/rewards/claim/instagram.png', href: 'https://www.instagram.com/bitcasinoio/' },
  { name: 'tiktok', src: '/images/rewards/claim/tiktok.png', href: 'https://www.tiktok.com/@bitcasino.io' },
  { name: 'youtube', src: '/images/rewards/claim/youtube.png', href: 'https://www.youtube.com/@BitcasinoioVIP' },
];

/**
 * What the claim control opens: the reference's `claim_reward_modal`, a sheet
 * that slides up from the seat of the screen and OVERLAPS whatever opened it —
 * the same width as the deposit drawer, as tall as its own content, `gohan`
 * with rounded top corners. Read off the cashier's own HTML, top to bottom —
 *
 *   close   a 32px bordered square at the top-LEFT, over the header banner
 *   header  the `claim-header.png` promo image, oversized and bled up past
 *           the sheet's rounded top so it reads as full-bleed
 *   form    the centered `Claim reward` heading, the 56px code field with
 *           `Enter reward code` prompt, and the full-width Claim button
 *   social  `We regularly post these on our social media channels` and the
 *           four 32px brand tiles, linked to the reference's own accounts
 *
 * It is NOT a centred card like `Dialog` or `SearchDialog`: on the reference
 * the modal is a bottom sheet over the cashier drawer, and it dims the
 * surface behind it. Its width is the DRAWER's width, never the site's —
 * full-bleed on a phone where the drawer is, `420px` beside it on desktop —
 * and it hugs the same end edge the drawer does. `w-full sm:max-w-[420px]` in
 * a 4px gutter (`px-1 pt-1`), `z-50` above the drawer. Height is the
 * content's own — the sheet is `h-auto` like the reference, with no inner
 * scrollbar.
 *
 * The one thing the reference snippet has no answer for is failure feedback:
 * its codes validate server-side. Ours does not, so the result line under the
 * field is `aria-live` and keeps focus in the field, where the next attempt
 * is typed.
 *
 * Lived in `pages/Rewards.jsx` until the wallet drawer's `Claim reward` row
 * needed the same dialog. A page importing from the drawer is fine; the drawer
 * importing back from the page is a cycle, so the dialog moved here to the
 * layer both of them can import from.
 */
export function ClaimRewardDialog({ open, onClose, onClaim }) {
  const [code, setCode] = useState('');
  const [result, setResult] = useState(null);
  // The sheet stays mounted for one animation after `open` goes false, so the
  // slide-down is not cut off by React unmounting the tree.
  const [closing, setClosing] = useState(false);

  const inputRef = useRef(null);
  const openerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    openerRef.current = document.activeElement;
    setClosing(false);
    setCode('');
    setResult(null);

    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);

    return () => {
      window.clearTimeout(id);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  const close = useCallback(() => {
    setClosing(true);
    window.setTimeout(() => {
      setClosing(false);
      onClose();
      openerRef.current?.focus?.();
    }, ANIMATION_MS);
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open && !closing) return null;

  const leaving = closing || !open;

  function submit(event) {
    event.preventDefault();
    setResult(onClaim(code));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end px-1 pt-1">
      <div
        role="presentation"
        onClick={close}
        className={cn(
          'absolute inset-0 bg-popo/50',
          leaving ? 'animate-overlay-out' : 'animate-overlay-in',
        )}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Claim reward"
        data-testid="claim_reward_modal"
        className={cn(
          'relative flex w-full flex-col overflow-hidden rounded-t-2xl',
          'bg-gohan text-bulma shadow-lg outline-none sm:max-w-[420px]',
          leaving ? 'animate-up-out' : 'animate-up-in',
        )}
      >
        <div className="px-4 pb-12 pt-4">
          <div className="flex flex-col gap-6">
            <div className="relative">
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                data-testid="close_action"
                className="absolute -left-2 -top-1 z-5 grid size-8 cursor-pointer place-items-center rounded-i-sm border-[0.8px] border-beerus bg-gohan text-bulma transition-colors hover:bg-heles"
              >
                <Icon name="close" size={18} />
              </button>

              {/* The reference's `-translate-y-7 scale-[115%] [m-auto]`: the
                  banner is larger than the field below it and bleeds up past
                  the sheet's rounded top, which the overflow-hidden parent
                  clips back to the visible edge. */}
              <img
                src={CLAIM_HEADER}
                alt="Claim reward"
                width="452"
                height="243"
                className="mx-auto -translate-y-7 scale-[115%]"
              />
            </div>

            <form onSubmit={submit} className="grid gap-4">
              <h3 className="mt-4 text-center font-medium leading-6 text-bulma">
                Claim reward
              </h3>

              <div
                className={cn(
                  'flex h-14 items-center rounded-i-sm border-[0.8px] border-beerus bg-goku px-4',
                  'transition-colors focus-within:border-piccolo focus-within:ring-3 focus-within:ring-piccolo/50',
                )}
              >
                <input
                  ref={inputRef}
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value);
                    setResult(null);
                  }}
                  placeholder="Enter reward code"
                  aria-label="Enter reward code"
                  data-testid="reward_code_input"
                  autoComplete="off"
                  className="h-full w-full min-w-0 bg-transparent text-base text-bulma outline-none placeholder:text-trunks"
                />
              </div>

              <p
                aria-live="polite"
                className={cn(
                  'min-h-5 text-sm leading-5',
                  result?.ok ? 'text-roshi' : 'text-chichi',
                )}
              >
                {message(result)}
              </p>

              <Button
                type="submit"
                size="lg"
                className="h-12 text-base font-normal"
                disabled={code.trim() === ''}
                fullWidth
                data-testid="claim_btn"
              >
                Claim
              </Button>
            </form>

            <div className="grid justify-items-center gap-3 pt-2">
              <p className="w-[300px] text-center text-sm text-trunks">
                We regularly post these on our social media channels
              </p>
              <div className="flex scale-125" data-testid="social_media_links">
                {SOCIAL.map((item) => (
                  <a
                    key={item.name}
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={item.name}
                    className="mx-1"
                  >
                    <img src={item.src} alt={item.name} width="32" height="32" />
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Matches the sheet slide-up/slide-down animation in index.css. */
const ANIMATION_MS = 150;

/** The one line under the field. Empty before anything has been submitted. */
function message(result) {
  if (!result) return '';
  if (result.ok) return `Claimed — ${result.reward.title} is now in your rewards.`;
  if (result.reason === 'already') return 'That code has already been claimed.';
  if (result.reason === 'unknown') return "That code isn't recognised.";
  return 'Enter a code to claim.';
}