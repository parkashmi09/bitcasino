import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import {
  AuthShell,
  AuthField,
  AuthCheckbox,
  RecaptchaNotice,
} from '@/components/layout/AuthShell';

/**
 * Log in.
 *
 * `AuthShell` carries the split screen, the brand block, the provider row and
 * the marketing panel — everything this page shares with `SignUp`. What is
 * left here is the form itself and the block of links under it.
 *
 * The submit is disabled until both fields carry something, which is the
 * reference's behaviour; `Create account` on the sign-up screen is not.
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
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [uses2FA, setUses2FA] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const ready = username.trim() !== '' && password !== '';

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
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(true);
        }}
      >
        <AuthField
          id="username"
          label="Username or Email"
          value={username}
          onChange={setUsername}
          autoComplete="username"
        />
        <AuthField
          id="password"
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />

        <AuthCheckbox name="uses2FA" checked={uses2FA} onChange={setUses2FA}>
          I use Google Authenticator
        </AuthCheckbox>

        <Button
          type="submit"
          fullWidth
          disabled={!ready}
          className="text-base disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-60"
        >
          Log in
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
