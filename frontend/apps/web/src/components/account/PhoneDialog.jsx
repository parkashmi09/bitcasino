import { useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { useAuth } from '@/auth/AuthProvider';
import { useGates } from '@/hooks/useGates';
import { ApiError, api } from '@/lib/api';
import { ENDPOINTS } from '@/lib/endpoints';
import { PHONE_MESSAGE, cleanPhone, isValidPhone } from '@/lib/phone';
import { cn } from '@/lib/cn';

/**
 * Add a mobile number to an account that has none (`PUT /user/profile/phone`, hash f3a287c6).
 * From Account any time; `forced` (RequirePhone below) has no close and offers only Sign out.
 */
export function AddPhoneDialog({ open, onClose, onSaved, forced = false }) {
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  const inputId = useId();

  const bad = phone.trim() !== '' && !isValidPhone(phone);

  async function submit(event) {
    event.preventDefault();
    if (!isValidPhone(phone) || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(ENDPOINTS.profilePhone, { method: 'PUT', body: { phone: cleanPhone(phone) } });
      await onSaved?.();
      setPhone('');
      if (!forced) onClose();
    } catch (cause) {
      // Already set (another tab): nothing left to ask, so read the account again.
      if (cause instanceof ApiError && cause.code === 'PROFILE_PHONE_ALREADY_SET') {
        await onSaved?.();
        if (!forced) onClose();
        return;
      }
      setError(
        cause instanceof ApiError
          ? cause.fieldError?.('phone') || cause.message
          : 'Could not save your mobile number. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add mobile number"
      initialFocus={inputRef}
      dismissible={!forced}
    >
      <form onSubmit={submit} className="grid gap-4">
        {forced && (
          <p className="text-base leading-6 text-bulma">
            A mobile number is required for every account. Add yours to continue.
          </p>
        )}
        <div className="grid gap-2">
          <label htmlFor={inputId} className="text-base leading-6 text-trunks">
            Mobile number
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="tel"
            value={phone}
            autoComplete="tel"
            placeholder="+447700900000"
            aria-invalid={bad || error ? true : undefined}
            onChange={(event) => {
              setPhone(event.target.value);
              setError(null);
            }}
            className={cn(
              'h-10 w-full min-w-0 rounded-i-sm border-[1.6px] border-hit bg-transparent px-2.5 text-base leading-6 text-bulma outline-none transition-colors focus:border-piccolo',
              (bad || error) && 'border-chichi focus:border-chichi',
            )}
          />
          <p className={cn('text-xs leading-4', bad ? 'text-chichi' : 'text-trunks')}>
            {bad ? PHONE_MESSAGE : 'With the country code, e.g. +44 7700 900000.'}
          </p>
        </div>
        {error && (
          <p role="alert" className="text-sm leading-5 text-chichi">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" fullWidth disabled={!isValidPhone(phone) || busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        {forced && (
          <Button variant="outline" size="lg" fullWidth onClick={onClose} disabled={busy}>
            Sign out
          </Button>
        )}
      </form>
    </Dialog>
  );
}

/**
 * Owner policy `phone_required: required`: a signed-in direct player (not an agent's player, not a
 * demo account) with no mobile number adds one before using the site. The only other way out is
 * signing out. Mounted beside ForcedPasswordChange; `/me` carries `phone`.
 */
export function RequirePhone() {
  const { user, status, logout, refreshUser } = useAuth();
  const gates = useGates();
  const navigate = useNavigate();

  const open =
    status === 'authenticated' &&
    gates.ready &&
    !gates.agentPlayer &&
    !gates.demo &&
    gates.phoneRequired() &&
    // Not until `/me` has answered: the sign-in summary may not carry the number at all.
    Boolean(user && 'phone' in user) &&
    !String(user.phone ?? '').trim();

  async function signOut() {
    await logout();
    navigate('/login', { replace: true });
  }

  return <AddPhoneDialog open={open} onClose={signOut} onSaved={refreshUser} forced />;
}
