import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthError, AuthField, AuthShell, Spinner } from '@/components/layout/AuthShell';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ApiError } from '@/lib/api';
import {
  OTP_LENGTH,
  OTP_TTL_SECONDS,
  useRequestResetCode,
  useResetPassword,
  useVerifyResetCode,
} from '@/queries';

/**
 * Password recovery, in three steps on one screen.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * THIS ROUTE WAS `<Navigate to="/login" />`.
 *
 * A player who forgot their password had no way back into their account at
 * all — the link in the login panel's footer sent them to the panel they had
 * just failed at. `docs/10` named it as the most-used recovery path on a real
 * casino, absent rather than deferred.
 *
 * The two `/email/otp*` routes it needed had existed since the port. What was
 * missing was the third leg: nothing on the platform spent a `reset-password`
 * proof, and `AuthService.completePasswordReset` was exposed on no transport.
 * `POST /user/auth/reset-password` is new, and this screen is its client.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ## One route, three steps, no wizard chrome
 *
 * The steps live in one component and one URL because they are one act and
 * because the state between them cannot survive a navigation: step three
 * needs the address AND the code, and putting either in a query string would
 * write a live credential into the history, the referrer and any logging
 * proxy between here and the CDN.
 *
 * ## What it must never say
 *
 * Step one answers identically whether or not the address has an account —
 * that is what stops the reset box being a membership check, and legacy
 * failed it by answering "User not found". So the copy after it is
 * conditional on nothing: "if that address has an account, a code is on its
 * way". It reads as hedging and it is the point.
 */

/**
 * `AuthShell`'s marketing column — the login panel's own three, verbatim.
 *
 * Recovery is a detour off the login screen and lands back on it, so the
 * panel beside the form should not change under the player. Writing copy
 * specific to this flow would also have meant two new illustrations, and
 * `public/images/auth/` has exactly the assets the two auth screens use.
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

const STEPS = ['email', 'code', 'password'];

export function ForgotPassword() {
  const navigate = useNavigate();

  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');

  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  /** Bumped on every refusal so `AuthError` remounts and the shake replays. */
  const [attempt, setAttempt] = useState(0);
  const [done, setDone] = useState(null);

  const request = useRequestResetCode();
  const verify = useVerifyResetCode();
  const reset = useResetPassword();

  const busy = request.isPending || verify.isPending || reset.isPending;

  /**
   * Seconds until the code the player is holding expires.
   *
   * Two minutes is short, and a form with no clock on it is how somebody
   * types a correct code into a dead one and is told it is "not valid" —
   * which reads as "you typed it wrong". Counting down turns that into a
   * thing they can see coming.
   */
  const [expiresIn, setExpiresIn] = useState(0);
  const deadline = useRef(0);

  useEffect(() => {
    if (step !== 'code') return undefined;

    const tick = () => {
      const left = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000));
      setExpiresIn(left);
    };

    tick();
    const id = window.setInterval(tick, 1_000);
    return () => window.clearInterval(id);
  }, [step]);

  const refuse = (failure, { field = false } = {}) => {
    setAttempt((count) => count + 1);
    if (field) setFieldError(failure);
    else setError(failure);
  };

  /** Clear both messages. Called at the top of every submit. */
  const clear = () => {
    setError('');
    setFieldError('');
  };

  /* ── Step one ───────────────────────────────────────────────────── */

  async function onRequest(event) {
    event.preventDefault();
    clear();

    try {
      const answer = await request.mutateAsync(email.trim().toLowerCase());

      /* The server's own deadline when it sent one, our constant otherwise.
         Preferring `expiresAt` means a deployment that changes the TTL does
         not leave this page counting down to the wrong moment. */
      const serverDeadline = answer?.expiresAt ? new Date(answer.expiresAt).getTime() : 0;
      deadline.current = Number.isFinite(serverDeadline) && serverDeadline > Date.now()
        ? serverDeadline
        : Date.now() + OTP_TTL_SECONDS * 1000;

      setCode('');
      setStep('code');
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;

      /**
       * The cooldown is the one refusal here that is safe to be specific
       * about, and it needs to be: it carries the seconds to wait, and
       * without them the player presses the button again and again.
       *
       * It is safe because a caller only reaches it by having asked for a
       * code for that address a moment ago — which they did themselves.
       */
      if (failure.code === 'EMAIL_OTP_COOLDOWN') {
        const wait = failure.details?.retryAfterSeconds;
        refuse(
          wait
            ? `A code was sent recently. Try again in ${wait} second${wait === 1 ? '' : 's'}.`
            : failure.message,
        );
        return;
      }

      if (failure.code === 'VALIDATION_ERROR') {
        refuse(failure.fieldError('email') ?? failure.message, { field: true });
        return;
      }

      // `EMAIL_SEND_FAILED`, `EMAIL_NOT_CONFIGURED`, a 429 and the offline
      // case all carry a message written for the person who hit it.
      refuse(failure.message);
    }
  }

  /* ── Step two ───────────────────────────────────────────────────── */

  async function onVerify(event) {
    event.preventDefault();
    clear();

    try {
      await verify.mutateAsync({ email: email.trim().toLowerCase(), code });
      setPassword('');
      setStep('password');
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;

      /**
       * Two of these end the code's life, and the page has to go BACK rather
       * than leave the player retyping into a row that can no longer pass.
       *
       * `TOO_MANY_ATTEMPTS` is the third wrong guess; `EXPIRED` is the two
       * minutes running out. In both cases the only way forward is a new
       * code, and a form that keeps accepting input is lying about that.
       */
      if (
        failure.code === 'EMAIL_OTP_TOO_MANY_ATTEMPTS' ||
        failure.code === 'EMAIL_OTP_EXPIRED'
      ) {
        setStep('email');
        setCode('');
        refuse(`${failure.message}.`);
        return;
      }

      refuse(failure.message, { field: true });
    }
  }

  /* ── Step three ─────────────────────────────────────────────────── */

  async function onReset(event) {
    event.preventDefault();
    clear();

    try {
      const answer = await reset.mutateAsync({
        email: email.trim().toLowerCase(),
        code,
        newPassword: password,
      });

      /* No session comes back, by design — every session on the account was
         just revoked. So this confirms and hands off to the login form
         rather than pretending to sign anybody in. */
      setDone({ revoked: Number(answer?.revokedSessions ?? 0) });
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;

      if (failure.code === 'AUTH_PASSWORD_REUSED') {
        refuse('That is the password you already have. Choose a different one.', {
          field: true,
        });
        return;
      }

      if (failure.code === 'VALIDATION_ERROR') {
        refuse(failure.fieldError('newPassword') ?? failure.message, { field: true });
        return;
      }

      /**
       * `EMAIL_OTP_INVALID` at THIS step means the proof went stale — the
       * five-minute window closed between verifying and submitting — rather
       * than a wrong code, because the code was checked a moment ago and has
       * not been retyped since.
       */
      if (failure.code === 'EMAIL_OTP_INVALID') {
        setStep('email');
        setCode('');
        refuse('That code is no longer valid. Request a new one.');
        return;
      }

      refuse(failure.message);
    }
  }

  /* ── Done ───────────────────────────────────────────────────────── */

  if (done) {
    return (
      <AuthShell
        heading="Password changed"
        image="/images/auth/login-hero.png"
        title="Enjoy premium gaming"
        benefits={BENEFITS}
        providers={false}
        footer={
          <p className="text-sm leading-6 text-trunks">
            Changed your mind?{' '}
            <Link to="/" className="text-piccolo hover:underline">
              Back to the site
            </Link>
          </p>
        }
      >
        <div className="grid gap-4">
          <p className="flex items-center gap-2 text-sm leading-6 text-bulma">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-piccolo/10 text-piccolo">
              <Icon name="check" size={18} />
            </span>
            Your password has been changed.
          </p>

          {/* The revocation is the reassurance, so it is stated rather than
              left as a footnote — somebody resetting a password usually
              believes another device has their account. */}
          <p className="text-sm leading-6 text-trunks">
            {done.revoked > 0
              ? `Every device signed in to this account has been signed out — ${done.revoked} session${done.revoked === 1 ? '' : 's'} ended.`
              : 'Every device signed in to this account has been signed out.'}
          </p>

          <Button fullWidth className="text-base" onClick={() => navigate('/login')}>
            Log in
          </Button>
        </div>
      </AuthShell>
    );
  }

  /* ── The three steps ────────────────────────────────────────────── */

  return (
    <AuthShell
      heading={
        step === 'email'
          ? 'Reset your password'
          : step === 'code'
            ? 'Enter your code'
            : 'Choose a new password'
      }
      image="/images/auth/login-hero.png"
      title="Enjoy premium gaming"
      benefits={BENEFITS}
      providers={false}
      footer={
        <div className="grid gap-2">
          <p className="flex flex-wrap items-center gap-2 text-sm leading-6 text-trunks">
            Remembered it?
            <Link to="/login" className="text-piccolo hover:underline">
              Log in
            </Link>
          </p>
          <p className="flex flex-wrap items-center gap-2 text-sm leading-6 text-trunks">
            Don&rsquo;t have an account?
            <Link to="/register" className="text-piccolo hover:underline">
              Create account
            </Link>
          </p>
        </div>
      }
    >
      <StepDots current={step} />

      {step === 'email' && (
        <form className="grid gap-3" onSubmit={onRequest} noValidate>
          <p className="text-sm leading-5 text-trunks">
            Enter the email address on your account and we will send you a{' '}
            {OTP_LENGTH}-digit code.
          </p>

          <AuthField
            id="email"
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="email"
            error={fieldError}
            disabled={busy}
          />

          <AuthError attempt={attempt}>{error}</AuthError>

          <Button
            type="submit"
            fullWidth
            disabled={busy || !email.trim()}
            className="text-base disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy && <Spinner />}
            {busy ? 'Sending code' : 'Send code'}
          </Button>
        </form>
      )}

      {step === 'code' && (
        <form className="grid gap-3" onSubmit={onVerify} noValidate>
          {/**
           * ═════════════════════════════════════════════════════════════
           * THIS SENTENCE IS CONDITIONAL ON NOTHING, AND MUST STAY THAT WAY.
           *
           * `POST /email/otp` answers the same thing whether or not the
           * address has an account, and sends nothing in the second case.
           * Saying "we sent you a code" would claim the address is
           * registered; saying "check your inbox — we found your account"
           * would say it outright. Either turns this form into a free list
           * of which addresses have accounts here, which is exactly what
           * legacy's `User not found` was.
           * ═════════════════════════════════════════════════════════════
           */}
          <p className="text-sm leading-5 text-trunks">
            If <span className="text-bulma">{email.trim().toLowerCase()}</span> has an account,
            a {OTP_LENGTH}-digit code is on its way to it.
          </p>

          <AuthField
            id="code"
            label="Code"
            value={code}
            /* Digits only, and clamped to six. The server's regex is exactly
               six digits — a space pasted in from an email client is a 422
               rather than a near miss, so it is stripped here. */
            onChange={(value) => setCode(value.replace(/\D/g, '').slice(0, OTP_LENGTH))}
            inputMode="numeric"
            autoComplete="one-time-code"
            error={fieldError}
            hint={
              expiresIn > 0
                ? `Expires in ${Math.floor(expiresIn / 60)}:${String(expiresIn % 60).padStart(2, '0')}`
                : 'This code has expired — request a new one.'
            }
            disabled={busy}
          />

          <AuthError attempt={attempt}>{error}</AuthError>

          <Button
            type="submit"
            fullWidth
            disabled={busy || code.length !== OTP_LENGTH || expiresIn === 0}
            className="text-base disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy && <Spinner />}
            {busy ? 'Checking' : 'Continue'}
          </Button>

          <button
            type="button"
            onClick={() => {
              clear();
              setCode('');
              setStep('email');
            }}
            className="cursor-pointer text-sm leading-6 text-trunks hover:text-bulma hover:underline"
          >
            Use a different address, or send a new code
          </button>
        </form>
      )}

      {step === 'password' && (
        <form className="grid gap-3" onSubmit={onReset} noValidate>
          <p className="text-sm leading-5 text-trunks">
            Your code is confirmed. Choose a new password — at least 10 characters.
          </p>

          <AuthField
            id="newPassword"
            label="New password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            error={fieldError}
            disabled={busy}
          />

          <AuthError attempt={attempt}>{error}</AuthError>

          <Button
            type="submit"
            fullWidth
            /* Ten characters is the server's floor (`auth.validators.js`),
               length-first with no composition rule. Enforced here so the
               button is honest rather than so the server can be trusted. */
            disabled={busy || password.length < 10}
            className="text-base disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy && <Spinner />}
            {busy ? 'Saving' : 'Change password'}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

/**
 * Three dots, filled up to the current step.
 *
 * Not a numbered wizard rail: this is a 380px column and the steps have no
 * names worth the width. What it communicates is only "there are three of
 * these and you are on the second", which is the thing that stops a two-minute
 * code feeling like an unbounded process.
 */
function StepDots({ current }) {
  const index = STEPS.indexOf(current);

  return (
    <div className="mb-1 flex gap-1.5" aria-hidden="true">
      {STEPS.map((step, position) => (
        <span
          key={step}
          className={`h-1 flex-1 rounded-full transition-colors ${
            position <= index ? 'bg-piccolo' : 'bg-beerus'
          }`}
        />
      ))}
    </div>
  );
}
