import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import {
  AuthShell,
  AuthField,
  AuthCheckbox,
  AuthLabel,
  RecaptchaNotice,
  AUTH_INPUT,
  AUTH_SELECT,
} from '@/components/layout/AuthShell';

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

const DIAL_CODES = [
  { code: '+61', label: 'AU (+61)' },
  { code: '+32', label: 'BE (+32)' },
  { code: '+55', label: 'BR (+55)' },
  { code: '+1', label: 'CA (+1)' },
  { code: '+49', label: 'DE (+49)' },
  { code: '+34', label: 'ES (+34)' },
  { code: '+33', label: 'FR (+33)' },
  { code: '+81', label: 'JP (+81)' },
  { code: '+82', label: 'KR (+82)' },
  { code: '+31', label: 'NL (+31)' },
  { code: '+48', label: 'PL (+48)' },
  { code: '+351', label: 'PT (+351)' },
  { code: '+46', label: 'SE (+46)' },
  { code: '+44', label: 'UK (+44)' },
];

/** A select with the empty row the reference shows before a choice is made. */
function Select({ id, value, onChange, options }) {
  return (
    <select
      id={id}
      name={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
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
  const [submitted, setSubmitted] = useState(false);

  const set = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));

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
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(true);
        }}
      >
        <AuthField
          id="username"
          label="Username"
          value={form.username}
          onChange={set('username')}
          autoComplete="username"
        />
        <AuthField
          id="email"
          label="Email"
          type="email"
          value={form.email}
          onChange={set('email')}
          autoComplete="email"
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
          <Select id="day" value={form.day} onChange={set('day')} options={DAYS} />
          <Select id="month" value={form.month} onChange={set('month')} options={MONTHS} />
          <Select id="year" value={form.year} onChange={set('year')} options={YEARS} />
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
          />
          <input
            id="phone"
            name="phone"
            type="tel"
            value={form.phone}
            onChange={(event) => set('phone')(event.target.value)}
            autoComplete="tel-national"
            className={AUTH_INPUT}
          />
        </div>

        <AuthField
          id="password"
          label="Password"
          type="password"
          value={form.password}
          onChange={set('password')}
          autoComplete="new-password"
        />

        <AuthCheckbox name="acceptsTerms" checked={acceptsTerms} onChange={setAcceptsTerms}>
          I agree to Terms &amp; Conditions and Privacy Policy
        </AuthCheckbox>

        <AuthCheckbox name="acceptsOffers" checked={acceptsOffers} onChange={setAcceptsOffers}>
          I agree to receive marketing communication about exclusive Bitcasino rewards and
          promotions
        </AuthCheckbox>

        <Button type="submit" fullWidth className="text-base">
          Create account
        </Button>

        {submitted && (
          <p role="status" className="text-xs leading-4 text-trunks">
            This is a front-end study — there is no account system behind this form.
          </p>
        )}
      </form>
    </AuthShell>
  );
}
