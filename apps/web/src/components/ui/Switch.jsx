import { cn } from '@/lib/cn';

/**
 * The reference's switch: a 44x24 track on a full radius with a 16px knob
 * inset 4px, `beerus` off and `piccolo` on. Measured off its own security page
 * — see `pages/Security.jsx`, which was the first surface to draw one.
 *
 * Two forms, and the difference is whether there is anything to press:
 *
 * - With `onChange` it is a real `<button role="switch">` and toggles.
 * - Without one it is a `div` that REPORTS a state — `aria-disabled`, `title`
 *   saying why. A `<button disabled>` is skipped by a screen reader, so the
 *   state it exists to announce would be unreachable. It is the same rule
 *   `MenuRow` follows for the account menu's unbuilt rows.
 *
 *   The 2FA switch used to be the example here, because no route existed to
 *   turn it on. Phase 6 wired `/2fa/*`, so it is interactive now — and it
 *   drops back to the reporting form only when `GET /2fa/status` itself
 *   failed, where acting on an unknown state is the thing to avoid.
 *
 * The knob is `gohan` rather than white because that is what it measured on a
 * `piccolo` track, and it keeps both states one control.
 */
export function Switch({ checked, onChange, label, reason, className }) {
  const interactive = typeof onChange === 'function';
  const Tag = interactive ? 'button' : 'div';

  return (
    <Tag
      {...(interactive
        ? { type: 'button', onClick: () => onChange(!checked) }
        : { 'aria-disabled': 'true' })}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={reason}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full p-1 transition-colors',
        checked ? 'bg-piccolo' : 'bg-beerus',
        interactive && 'cursor-pointer',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-1 block size-4 rounded-full bg-gohan transition-all duration-200',
          checked ? 'start-6' : 'start-1',
        )}
      />
    </Tag>
  );
}
