import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthError, AuthShell, Spinner } from '@/components/layout/AuthShell';
import { useAuth } from '@/auth/AuthProvider';
import { api } from '@/lib/api';
import { ENDPOINTS } from '@/lib/endpoints';
import { googleErrorMessage, takeGoogleNonce } from '@/lib/googleAuth';

/** What the return trip brought: the code to trade, or why there is nothing to trade. */
function readReturn() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const failed = params.get('error');
  if (failed || !code) return { error: googleErrorMessage(failed) };
  return { code };
}

/** The code already sent — a code is single-use, and StrictMode runs effects twice. */
let exchanged = null;

/**
 * `/login/google` — where the backend sends the browser back after Google (`lib/googleAuth.js`):
 * trades the one-time `code` (with this tab's nonce) for the session, then goes home. An `error`
 * or a failed exchange is shown with a way back to the login form.
 */
export function GoogleLogin() {
  const { acceptSession } = useAuth();
  const navigate = useNavigate();
  const [{ code, error: returnError }] = useState(readReturn);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Drop the code from the address bar and history straight away.
    window.history.replaceState(window.history.state, '', '/login/google');
    if (!code || exchanged === code) return;
    exchanged = code;
    const nonce = takeGoogleNonce();
    if (!nonce) {
      setError('Google sign-in did not complete. Please start again from this browser tab.');
      return;
    }
    api(ENDPOINTS.googleExchange, { method: 'POST', auth: false, body: { code, nonce } })
      .then(acceptSession)
      .then(() => navigate('/', { replace: true }))
      .catch((e) => setError(googleErrorMessage(e?.code, e?.message)));
  }, [code, acceptSession, navigate]);

  const message = returnError || error;

  return (
    <AuthShell
      heading="Sign in with Google"
      image="/images/auth/login-hero.png"
      title="Enjoy premium gaming"
      benefits={[]}
      providers={false}
      footer={
        message && (
          <Link to="/login" className="text-base text-piccolo underline-offset-2 hover:underline">
            Back to log in
          </Link>
        )
      }
    >
      {message ? (
        <AuthError>{message}</AuthError>
      ) : (
        <p className="flex items-center gap-2 text-base text-trunks">
          <Spinner /> Signing you in…
        </p>
      )}
    </AuthShell>
  );
}
