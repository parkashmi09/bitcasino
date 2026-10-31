import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { dismissToast, subscribeToasts } from '@/lib/toast';
import { cn } from '@/lib/cn';

/* The reference's Moon snackbar: goku surface, 12px radius (--component-snackbar-radius), shadow-lg,
   a tinted round icon, the message in bulma; top-right on desktop, full width under the header on a phone. */
const TONES = {
  success: { icon: 'check', tint: 'bg-roshi/15 text-roshi' },
  info: { icon: 'info', tint: 'bg-whis/15 text-whis' },
  warning: { icon: 'alert', tint: 'bg-krillin/15 text-krillin' },
  error: { icon: 'alert', tint: 'bg-chichi/15 text-chichi' },
};

export function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => subscribeToasts(setItems), []);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 top-4 z-[60] flex flex-col items-stretch gap-2 sm:inset-x-auto sm:right-6 sm:w-[min(24rem,calc(100vw-3rem))]"
    >
      {items.map((t) => {
        const tone = TONES[t.tone] ?? TONES.info;
        return (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={cn(
              'animate-menu-in pointer-events-auto flex items-center gap-3 border-[0.8px] border-beerus bg-goku p-3 pr-2',
              'rounded-[var(--component-snackbar-radius,12px)] shadow-[var(--shadow-lg)]',
            )}
          >
            <span className={cn('grid size-8 shrink-0 place-items-center rounded-full', tone.tint)}>
              <Icon name={tone.icon} size={18} />
            </span>
            <div className="min-w-0 flex-1 text-sm leading-snug">
              {t.title && <p className="font-medium text-bulma">{t.title}</p>}
              <p className={cn('break-words', t.title ? 'text-trunks' : 'text-bulma')}>{t.message}</p>
            </div>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              aria-label="Dismiss"
              className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-i-sm text-trunks transition-colors hover:bg-heles hover:text-bulma"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
