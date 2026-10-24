import { useId, useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * A password field with the reference's `Show` control inside it.
 *
 * `Show` is a `<button>`, not a link: it changes what is on screen and goes
 * nowhere. It carries `aria-pressed` so the state is announced, and it is
 * `tabIndex={-1}` — tabbing from one password field should reach the next
 * field, not a visibility toggle in between, and the control stays reachable
 * by pointer and by the screen reader's own navigation.
 *
 * `ref` goes to the input so a dialog can focus the first field on open.
 *
 * Lifted out of `Security.jsx` in Phase 6, when the two-factor disable form
 * became a second caller — it takes the account password for the same reason
 * the change-password form does.
 */
export function PasswordField({ ref, label, value, onChange, autoComplete, error }) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const messageId = error ? `${id}-error` : undefined;

  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-base leading-6 text-trunks">
        {label}
      </label>

      <div
        className={cn(
          'flex h-10 items-center gap-2 rounded-i-sm border-[1.6px] bg-transparent px-2.5',
          'transition-colors focus-within:border-piccolo',
          error ? 'border-chichi' : 'border-hit',
        )}
      >
        <input
          ref={ref}
          id={id}
          name={id}
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          aria-describedby={messageId}
          className="h-full w-full min-w-0 bg-transparent text-base leading-6 text-bulma outline-none placeholder:text-trunks"
        />
        <button
          type="button"
          tabIndex={-1}
          aria-pressed={shown}
          onClick={() => setShown((value_) => !value_)}
          className="shrink-0 cursor-pointer text-sm font-medium text-bulma underline underline-offset-2 transition-colors hover:text-piccolo"
        >
          {shown ? 'Hide' : 'Show'}
        </button>
      </div>

      {error && (
        <p id={messageId} className="text-xs leading-4 text-chichi">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The six-digit field every authenticator step uses.
 *
 * `inputMode="numeric"` and `autoComplete="one-time-code"` are what make a
 * phone show a number pad and offer the code from the notification shade;
 * `maxLength` and the digit strip mean a pasted `123 456` still submits as
 * `123456` rather than failing the server's `^\d{6}$`.
 */
export function CodeField({ ref, label = 'Authentication code', value, onChange, error, hint }) {
  const id = useId();
  const messageId = error ? `${id}-error` : undefined;

  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-base leading-6 text-trunks">
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        name={id}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        placeholder="000000"
        aria-invalid={error ? true : undefined}
        aria-describedby={messageId}
        className={cn(
          'h-10 w-full rounded-i-sm border-[1.6px] bg-transparent px-2.5',
          'font-mono text-base tracking-[0.3em] text-bulma outline-none',
          'transition-colors focus:border-piccolo placeholder:tracking-[0.3em] placeholder:text-trunks',
          error ? 'border-chichi' : 'border-hit',
        )}
      />
      {error ? (
        <p id={messageId} className="text-xs leading-4 text-chichi">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs leading-4 text-trunks">{hint}</p>
      ) : null}
    </div>
  );
}
