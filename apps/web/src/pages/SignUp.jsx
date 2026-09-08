import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import {
  AuthShell,
  AuthField,
  AuthCheckbox,
  AuthError,
  AuthLabel,
  Spinner,
  RecaptchaNotice,
  AUTH_INPUT,
  AUTH_SELECT,
} from '@/components/layout/AuthShell';
import { useAuth } from '@/auth/AuthProvider';
import { ApiError, api } from '@/lib/api';
import { ENDPOINTS, path } from '@/lib/endpoints';
import { DIAL_CODES } from '@/data/countries';

/**
 * Sign up.
 *
 * Same shell as `Login` — see `AuthShell` — with a longer form. Everything
 * down to the OR rule is identical and lands on the same coordinates; the form
 * below it is where the two diverge.
 *
 * Measured off the reference, the form is a flat `gap-2` grid whose rows are:
 * username (72), email (72), date of birth (72), phone (72), password (72),
 * consent (24), marketing consent (32), submit (40). Each 72px row is a label
 * over a 40px control with the 8px carried by the label. The two multi-control
 * rows are sub-grids that supply their own 8px row gap instead, which is why
 * their labels sit at 24 rather than 32:
 *
 * - date of birth — three equal 108px columns at 8px
 * - phone — `121px 1fr` at 16px, so the dial code stays narrow
 *
 * One thing the reference has that this does not: a reCAPTCHA widget between
 * the consent boxes and the submit, which is what opens the 94px gap there.
 * There is no captcha service behind this build, so the submit sits at 723 —
 * and every row below it lines up with the reference again.
 *
 * ── WHAT REACHES THE PLATFORM, AND WHAT DOES NOT ──────────────────────
 *
 * `POST /user/auth/register` declares exactly six fields — `username`,
 * `password`, and optional `email`, `phone`, `country`, `referredBy` — behind a
 * `.strict()` validator, so an extra key is a 422 rather than an ignored value.
 * Spreading this form's state into the body would send `day`, `month`, `year`,
 * `dialCode` and both consent flags, and every signup would fail. `body()`
 * below is therefore a projection, not a spread, and it is the only place that
 * decides what is sent.
 *
 * The three things the form collects that the account does not carry:
 *
 * - **Date of birth** is the age gate stated in the fine print. There is no
 *   column for it, and KYC is where the platform actually establishes age
 *   (`POST /user/kyc/submit`), so it is checked here and dropped.
 * - **Dial code** is not its own field either; it is joined to the number, so
 *   `+44` and `7700900000` reach the platform as one `phone` string.
 * - **The consent boxes** gate the submit. Terms acceptance is recorded by the
 *   act of creating the account; there is no endpoint that takes it separately,
 *   and inventing a field for it would 422.
 *
 * Password is the one rule worth stating in the UI: **ten characters minimum,
 * no composition rule**. Saying so under the field is kinder than letting the
 * server say it after the form has been filled in.
 *
 * A `?ref=` in the URL is somebody else's referral code and becomes
 * `referredBy` — NOT `referalcode`, which is this account's own and is one
 * letter away in the database. It is checked against the public verify route
 * before submit so a mistyped link says so here rather than silently crediting
 * nobody.
 */

const BENEFITS = [
  {
    icon: '/images/auth/vip.png',
    title: 'VIP experiences',
    body: 'Access invite-only events and red-carpet treatment',
  },
  {
    icon: '/images/auth/wallet.png',
    title: 'Instant withdrawals',
    body: 'Enjoy industry-leading withdrawal speeds',
  },
  {
    icon: '/images/auth/cashback.png',
    title: 'Zero wagering',
    body: 'Receive your rewards without hidden requirements',
  },
];

const DAYS = Array.from({ length: 31 }, (_, index) => String(index + 1));

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/* Eighteen years back is the newest date of birth the form will offer, which
   is the age gate stated in the fine print rather than a validation rule. */
const NEWEST_BIRTH_YEAR = new Date().getFullYear() - 18;
const YEARS = Array.from({ length: 83 }, (_, index) => String(NEWEST_BIRTH_YEAR - index));

/** The platform's own floor, restated so the form can enforce it first. */
const MIN_PASSWORD = 10;

/** A select with the empty row the reference shows before a choice is made. */
function Select({ id, value, onChange, options, disabled }) {
  return (
    <select
      id={id}
      name={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      className={AUTH_SELECT}
    >
      <option value="" />
      {options.map((option) => {
        const optionValue = typeof option === 'string' ? option : option.code;
        const optionLabel = typeof option === 'string' ? option : option.label;
        return (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        );
      })}
    </select>
  );
}

export function SignUp() {
  const navigate = useNavigate();
  const { register } = useAuth();
  const [searchParams] = useSearchParams();
  const referredBy = searchParams.get('ref')?.trim() || '';

  const [form, setForm] = useState({
    username: '',
    email: '',
    day: '',
    month: '',
    year: '',
    dialCode: '',
    phone: '',
    password: '',
  });
  const [acceptsTerms, setAcceptsTerms] = useState(false);
  // Pre-ticked, as on the reference.
  const [acceptsOffers, setAcceptsOffers] = useState(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [attempt, setAttempt] = useState(0);
  // null while unchecked or absent, then true/false from the public route.
  const [referralValid, setReferralValid] = useState(null);

  const set = (key) => (value) => {
    setForm((current) => ({ ...current, [key]: value }));
    // The message under a field described the value that has just changed, so
    // it stops being true the moment it does.
    setFieldErrors((current) => (current[key] ? { ...current, [key]: null } : current));
  };

  // A referral code arrives in the link, so it is resolved on arrival rather
  // than at submit — being told the link is stale after filling in the form is
  // the worst moment to hear it.
  useEffect(() => {
    if (!referredBy) return undefined;

    const controller = new AbortController();
    api(path(ENDPOINTS.verifyReferral, { referralCode: referredBy }), {
      auth: false,
      signal: controller.signal,
    })
      .then((result) => setReferralValid(Boolean(result?.valid)))
      // A rate limit or an outage is not a verdict on the code; the register
      // call is the authority and it takes the code either way.
      .catch(() => setReferralValid(null));

    return () => controller.abort();
  }, [referredBy]);

  const bornOn = form.day && form.month && form.year;

  /**
   * Only the six fields the validator declares, and only the optional ones
   * that were actually filled in — an empty string is a value, and `email: ''`
   * fails the address rule rather than being read as "no email given".
   */
  function body() {
    const country = DIAL_CODES.find((entry) => entry.code === form.dialCode)?.country;
    const phone = form.phone.trim();

    return {
      username: form.username.trim(),
      password: form.password,
      ...(form.email.trim() ? { email: form.email.trim() } : {}),
      ...(phone ? { phone: `${form.dialCode}${phone}` } : {}),
      ...(country ? { country } : {}),
      ...(referredBy ? { referredBy } : {}),
    };
  }

  /**
   * The rules the form can check without a round trip.
   *
   * The submit stays enabled while these fail, which is the reference's
   * behaviour — it validates on press, not on keystroke — and the reason the
   * two consent and age gates are checked here rather than by disabling the
   * button: a button that is dark for no stated reason is the worst of the
   * three ways to say "not yet".
   */
  function localErrors() {
    const found = {};
    if (form.username.trim().length < 3) {
      found.username = 'Pick a username of at least 3 characters.';
    } else if (!/^[A-Za-z0-9_.-]+$/.test(form.username.trim())) {
      found.username = 'Letters, digits and _ . - only.';
    }
    if (form.password.length < MIN_PASSWORD) {
      found.password = `Use at least ${MIN_PASSWORD} characters.`;
    }
    if (form.phone.trim() && !form.dialCode) {
      found.dialCode = 'Choose a country code for that number.';
    }
    return found;
  }

  /** The two gates that have no field of their own to be marked. */
  function gateMessage() {
    if (!bornOn) return 'Enter your date of birth. You must be 18 or over to play.';
    if (!acceptsTerms) return 'Accept the Terms & Conditions and Privacy Policy to continue.';
    return null;
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;

    setError(null);

    const gate = gateMessage();
    const found = localErrors();

    if (gate || Object.keys(found).length) {
      setFieldErrors(found);
      setAttempt((count) => count + 1);
      setError(gate ?? 'Check the highlighted fields and try again.');
      return;
    }

    setBusy(true);
    setFieldErrors({});

    try {
      // 201 with a session in the body: registering signs the account in, so
      // there is nothing to do here but go.
      await register(body());
      navigate('/', { replace: true });
      return;
    } catch (failure) {
      setAttempt((count) => count + 1);

      if (!(failure instanceof ApiError)) {
        setError('Something went wrong. Please try again.');
        return;
      }

      switch (failure.code) {
        case 'VALIDATION_ERROR':
          // `details.fields` is one entry per field, named as the validator
          // names it — which is this form's own ids for all six.
          setFieldErrors(
            Object.fromEntries((failure.fields ?? []).map((issue) => [issue.field, issue.message])),
          );
          setError(failure.message);
          break;

        case 'AUTH_ALREADY_REGISTERED':
          // The one place the platform names the colliding field, deliberately:
          // a signup form that cannot say "that username is taken" is unusable,
          // and both values were just supplied by the person reading this.
          setFieldErrors({ [failure.details?.field ?? 'username']: 'That is already registered.' });
          setError(failure.message);
          break;

        default:
          // TOO_MANY_REQUESTS, AUTH_REGISTRATION_FAILED and the network failure.
          setError(failure.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      heading="Sign up"
      image="/images/auth/signup-hero.png"
      title="Enjoy premium gaming"
      benefits={BENEFITS}
      footer={
        <div className="grid gap-2">
          <Link to="/terms" className="text-sm leading-6 text-piccolo hover:underline">
            Terms &amp; Conditions
          </Link>
          <Link to="/privacy" className="text-sm leading-6 text-piccolo hover:underline">
            Privacy Policy
          </Link>

          <p className="flex flex-wrap items-center gap-2 text-sm leading-6 text-trunks">
            Already have an account?
            <Link to="/login" className="text-piccolo hover:underline">
              Log in
            </Link>
          </p>

          <RecaptchaNotice />

          {/* Locale picker, bottom of the panel and half width — the reference
              puts one here on sign-up but not on log in. Static, like the
              sidebar's. */}
          <button
            type="button"
            className="mt-2 flex h-10 w-1/2 items-center justify-between gap-1.5 rounded-i-sm border-[0.8px] border-hit bg-transparent py-2 pe-2 ps-2.5 text-sm text-trunks transition-colors hover:bg-heles"
          >
            English
            <Icon name="chevron-down" size={16} />
          </button>
        </div>
      }
    >
      <form className="grid gap-2" onSubmit={onSubmit} noValidate>
        <AuthField
          id="username"
          label="Username"
          value={form.username}
          onChange={set('username')}
          autoComplete="username"
          error={fieldErrors.username}
          disabled={busy}
        />
        <AuthField
          id="email"
          label="Email"
          type="email"
          value={form.email}
          onChange={set('email')}
          autoComplete="email"
          error={fieldErrors.email}
          disabled={busy}
        />

        {/* Three equal columns; the sub-grid's own 8px row gap replaces the
            padding a standalone label would carry. */}
        <div className="grid grid-cols-3 gap-2">
          <AuthLabel htmlFor="day" inGrid>
            Day
          </AuthLabel>
          <AuthLabel htmlFor="month" inGrid>
            Month
          </AuthLabel>
          <AuthLabel htmlFor="year" inGrid>
            Year
          </AuthLabel>
          <Select id="day" value={form.day} onChange={set('day')} options={DAYS} disabled={busy} />
          <Select
            id="month"
            value={form.month}
            onChange={set('month')}
            options={MONTHS}
            disabled={busy}
          />
          <Select
            id="year"
            value={form.year}
            onChange={set('year')}
            options={YEARS}
            disabled={busy}
          />
        </div>

        <div className="grid grid-cols-[121px_1fr] gap-x-4 gap-y-2">
          <AuthLabel htmlFor="dialCode" inGrid>
            Country Code
          </AuthLabel>
          <AuthLabel htmlFor="phone" inGrid>
            Phone nr (optional)
          </AuthLabel>
          <Select
            id="dialCode"
            value={form.dialCode}
            onChange={set('dialCode')}
            options={DIAL_CODES}
            disabled={busy}
          />
          <input
            id="phone"
            name="phone"
            type="tel"
            value={form.phone}
            onChange={(event) => set('phone')(event.target.value)}
            autoComplete="tel-national"
            disabled={busy}
            className={AUTH_INPUT}
          />
          {(fieldErrors.dialCode || fieldErrors.phone) && (
            <p className="col-span-2 text-xs leading-4 text-chichi">
              {fieldErrors.dialCode || fieldErrors.phone}
            </p>
          )}
        </div>

        <AuthField
          id="password"
          label="Password"
          type="password"
          value={form.password}
          onChange={set('password')}
          autoComplete="new-password"
          error={fieldErrors.password}
          hint={`At least ${MIN_PASSWORD} characters. Length is the only rule.`}
          disabled={busy}
        />

        {/* Only rendered when the link carried one — an empty referral row on
            every signup is a question nobody asked. */}
        {referredBy && (
          <p
            className={
              referralValid === false
                ? 'text-xs leading-4 text-krillin'
                : 'text-xs leading-4 text-trunks'
            }
          >
            {referralValid === false
              ? `We could not find the referral code “${referredBy}”. You can still sign up.`
              : `Referral code “${referredBy}” will be applied.`}
          </p>
        )}

        <AuthCheckbox name="acceptsTerms" checked={acceptsTerms} onChange={setAcceptsTerms}>
          I agree to Terms &amp; Conditions and Privacy Policy
        </AuthCheckbox>

        <AuthCheckbox name="acceptsOffers" checked={acceptsOffers} onChange={setAcceptsOffers}>
          I agree to receive marketing communication about exclusive Bitcasino rewards and
          promotions
        </AuthCheckbox>

        <AuthError attempt={attempt}>{error}</AuthError>

        <Button
          type="submit"
          fullWidth
          disabled={busy}
          className="text-base disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy && <Spinner />}
          {busy ? 'Creating account' : 'Create account'}
        </Button>
      </form>
    </AuthShell>
  );
}
