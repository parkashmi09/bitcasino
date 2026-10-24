import { cn } from '@/lib/cn';

/** Tone keys: brand, positive, caution, negative, neutral, jackpot. */
const TONES = {
  brand: 'bg-piccolo text-goten',
  positive: 'bg-roshi text-goten',
  caution: 'bg-krillin text-popo',
  negative: 'bg-chichi text-goten',
  neutral: 'bg-popo/70 text-goten backdrop-blur-sm',
  jackpot: 'bg-jackpot text-goten',
};

export function Badge({ tone = 'brand', className, children }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-i-xs px-1.5 py-0.5',
        'text-[10px] font-bold uppercase tracking-wide leading-4',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
