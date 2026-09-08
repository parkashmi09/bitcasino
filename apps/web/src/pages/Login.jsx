import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import {
  AuthShell,
  AuthField,
  AuthCheckbox,
  AuthError,
  Spinner,
  RecaptchaNotice,
} from '@/components/layout/AuthShell';
import { useAuth } from '@/auth/AuthProvider';
import { ApiError } from '@/lib/api';

/**
 * Log in.
 *
 * `AuthShell` carries the split screen, the brand block, the provider row and
 * the marketing panel — everything this page shares with `SignUp`. What is
 * left here is the form itself and the block of links under it.
 *
 * The submit is disabled until both fields carry something, which is the
 * reference's behaviour; `Create account` on the sign-up screen is not.
 *
 * ── WHAT THE PLATFORM ACTUALLY TAKES ──────────────────────────────────
 *
 * One field, named `identifier`, holding a username, an email OR a phone
 * number — the backend tries all three (`auth.service.js`, the `Op.or`), which
 * is why the label says "Username or Email" and there is no picker. The body
 * validator is `.strict()`, so nothing else this form knows about the visitor
 * can be sent along; `AuthProvider.login` builds the body from three named
 * values rather than spreading form state.
 *
 * ── AND WHY THE 2FA CHECKBOX IS NOT DECORATION ────────────────────────
 *
 * The reference has a checkbox reading "I use Google Authenticator" that
 * reveals a code field. This one does the same, and it is also driven from the
 * server: a correct password on a 2FA account answers
 * `AUTH_TWO_FACTOR_REQUIRED` rather than a session, so the field opens and
 * takes focus on that error whether or not the box was ticked. Nobody has to
 * know to tick it first.
 *
 * Errors are read by `code`, never by message. The copy below is the server's
 * own where it is already right for a player, and ours only where the form can
 * say something more useful than the API can.
 */

const BENEFITS = [
  {
    icon: '/images/auth/plane.png',
    title: 'VIP experiences',
    body: 'Access invite-only events and red-carpet treatment',
  },
  {
    icon: '/images/auth/slots.png',
    title: '7000+ games',
    body: 'Explore a menu with more than 7,000 slots, table games, and live games',
  },
  {
    icon: '/images/auth/vip.png',
    title: 'Exclusive Club',
    body: 'Discover an exclusive set of live games with unparalleled bet limits',
  },
];

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [uses2FA, setUses2FA] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [codeError, setCodeError] = useState(null);
  // Bumped on every rejection so `AuthError` remounts and replays its shake —
  // the same wrong password twice has to look like two rejections.
  const [attempt, setAttempt] = useState(0);

  const codeRef = useRef(null);

  // Opening the panel should put the caret in it. Keyed on the transition into
  // `uses2FA`, so ticking the box and being sent there by the server both land.
  useEffect(() => {
    if (uses2FA) codeRef.current?.focus();
  }, [uses2FA]);

  const ready = identifier.trim() !== '' && password !== '';

  // A guard route sends the player here with where they were headed; the login
  // returns them to it rather than to the home page.
  const destination = location.state?.from?.pathname ?? '/';

  async function onSubmit(event) {
    event.preventDefault();
    if (!ready || busy) return;

    setBusy(true);
    setError(null);
    setCodeError(null);

    try {
      await login({ identifier, password, twoFactorCode: uses2FA ? twoFactorCode : '' });
      navigate(destination, { replace: true });
      return;
    } catch (failure) {
      setAttempt((count) => count + 1);

      if (!(failure instanceof ApiError)) {
        setError('Something went wrong. Please try again.');
        return;
      }

      switch (failure.code) {
        case 'AUTH_TWO_FACTOR_REQUIRED':
          // The password was right. Open the field rather than reporting a
          // failure — nothing the player did was wrong.
          setUses2FA(true);
          setError('Enter the 6-digit code from your authenticator app.');
          break;

        case 'AUTH_TWO_FACTOR_INVALID':
          setUses2FA(true);
          setTwoFactorCode('');
          setCodeError(failure.message);
          break;

        case 'VALIDATION_ERROR':
          // 422, with one `details.fields` entry per field that failed. Only
          // the code has anywhere of its own to put a message; the other two
          // are free text and the banner says it better.
          setCodeError(failure.fieldError('twoFactorCode'));
          setError(
            failure.fieldError('identifier') ?? failure.fieldError('password') ?? failure.message,
          );
          break;

        default:
          // AUTH_INVALID_CREDENTIALS, AUTH_ACCOUNT_LOCKED, AUTH_ACCOUNT_INACTIVE,
          // AUTH_TOO_MANY_ATTEMPTS, TOO_MANY_REQUESTS and the network failure
          // all carry a message written for the person who hit it.
          setError(failure.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      heading="Log in"
      image="/images/auth/login-hero.png"
      title="Enjoy premium gaming"
      benefits={BENEFITS}
      footer={
        <div className="grid gap-2">
          <Link to="/forgot-password" className="text-base leading-6 text-bulma hover:underline">
            Forgot password?
          </Link>

          <p className="flex flex-wrap items-center gap-2 text-sm leading-6 text-trunks">
            Don&rsquo;t have an account?
            <Link to="/register" className="text-piccolo hover:underline">
              Create account
            </Link>
          </p>

          <RecaptchaNotice />
        </div>
      }
    >
      <form className="grid gap-2" onSubmit={onSubmit} noValidate>
        <AuthField
          id="identifier"
          label="Username or Email"
          value={identifier}
          onChange={setIdentifier}
          autoComplete="username"
          disabled={busy}
        />
        <AuthField
          id="password"
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          disabled={busy}
        />

        <AuthCheckbox name="uses2FA" checked={uses2FA} onChange={setUses2FA}>
          I use Google Authenticator
        </AuthCheckbox>

        {/* `reveal` opens the row over 200ms by growing a 0fr grid track — see
            index.css. The field stays mounted through the close, so a code
            already typed survives an accidental untick. */}
        <div className="reveal" data-open={uses2FA}>
          <div>
            <div className="pb-2">
              <AuthField
                id="twoFactorCode"
                label="Authentication code"
                value={twoFactorCode}
                onChange={(value) => setTwoFactorCode(value.replace(/\D/g, '').slice(0, 6))}
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                error={codeError}
                disabled={busy}
                ref={codeRef}
              />
            </div>
          </div>
        </div>

        <AuthError attempt={attempt}>{error}</AuthError>

        <Button
          type="submit"
          fullWidth
          disabled={!ready || busy}
          className="text-base disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy && <Spinner />}
          {busy ? 'Logging in' : 'Log in'}
        </Button>
      </form>
    </AuthShell>
  );
}
