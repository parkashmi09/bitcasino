import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { CodeField } from '@/components/ui/PasswordField';
import { useConfirmTwoFactorReset, useRequestTwoFactorReset } from '@/queries/recovery';
import { cn } from '@/lib/cn';

/**
 * Lost authenticator, from the login form: mail a code to the account's address, then turn the
 * second factor off with it (`POST /email/2fa/reset` → `/email/2fa/reset/confirm`).
 *
 * The request step answers the same whether or not the account exists or uses 2FA, so the copy
 * after it says what was done ("if…, we sent a code"), never what was found.
 */
export function LostTwoFactorDialog({ open, onClose, identifier: initial = '' }) {
  const request = useRequestTwoFactorReset();
  const confirm = useConfirmTwoFactorReset();
  const [identifier, setIdentifier] = useState(initial);
  const [code, setCode] = useState('');
  const [step, setStep] = useState('ask');
  const inputRef = useRef(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    setIdentifier(initial);
    setCode('');
    setStep('ask');
    request.reset();
    confirm.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function send(event) {
    event.preventDefault();
    try {
      await request.mutateAsync({ identifier });
      setStep('code');
    } catch {
      // `request.error` carries it.
    }
  }

  async function submit(event) {
    event.preventDefault();
    try {
      await confirm.mutateAsync({ identifier, code });
      setStep('done');
    } catch {
      setCode('');
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Lost your authenticator?" initialFocus={inputRef}>
      {step === 'done' ? (
        <div className="grid gap-4">
          <p className="text-base leading-6 text-trunks">
            Two-factor authentication is off. Log in with your password, then turn it back on
            under Profile &gt; Security.
          </p>
          <Button size="lg" fullWidth onClick={onClose}>
            Back to log in
          </Button>
        </div>
      ) : step === 'code' ? (
        <form onSubmit={submit} className="grid gap-4">
          <p className="text-base leading-6 text-trunks">
            If that account uses two-factor authentication, we sent a 6-digit code to its email
            address. Enter it to turn two-factor authentication off.
          </p>
          <CodeField
            ref={inputRef}
            label="Email code"
            value={code}
            onChange={setCode}
            error={confirm.isError ? confirm.error?.message : undefined}
          />
          <Button type="submit" size="lg" fullWidth disabled={code.length !== 6 || confirm.isPending}>
            {confirm.isPending ? 'Checking…' : 'Turn off two-factor'}
          </Button>
          <button
            type="button"
            onClick={() => setStep('ask')}
            className="cursor-pointer justify-self-center text-sm text-piccolo hover:underline"
          >
            Send another code
          </button>
        </form>
      ) : (
        <form onSubmit={send} className="grid gap-4">
          <p className="text-base leading-6 text-trunks">
            Enter your username or email. We send a code to the email address on the account.
          </p>
          <div className="grid gap-2">
            <label htmlFor={id} className="text-base leading-6 text-trunks">
              Username or Email
            </label>
            <input
              ref={inputRef}
              id={id}
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              autoComplete="username"
              className={cn(
                'h-10 w-full rounded-i-sm border-[1.6px] bg-transparent px-2.5 text-base text-bulma outline-none',
                'transition-colors focus:border-piccolo',
                request.isError ? 'border-chichi' : 'border-hit',
              )}
            />
            {request.isError && (
              <p className="text-xs leading-4 text-chichi">
                {request.error?.message || 'Could not send a code. Please try again.'}
              </p>
            )}
          </div>
          <Button type="submit" size="lg" fullWidth disabled={!identifier.trim() || request.isPending}>
            {request.isPending ? 'Sending…' : 'Send code'}
          </Button>
        </form>
      )}
    </Dialog>
  );
}
