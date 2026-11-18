import { afterEach, describe, expect, it, vi } from 'vitest';

/** The real route tree at one address. `AGENT_SITE` is read at load, so each run loads the app afresh. */
async function open(address) {
  window.history.replaceState(null, '', address);
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
  const [{ render, screen, waitFor, cleanup }, { QueryClient, QueryClientProvider }, { default: App }] = await Promise.all([
    import('@testing-library/react'),
    import('@tanstack/react-query'),
    import('./App'),
  ]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
  return { screen, waitFor, cleanup };
}

describe('/agent sign-in', () => {
  let close;
  afterEach(() => {
    close?.();
    vi.unstubAllGlobals();
    window.history.replaceState(null, '', '/');
  });

  it.each([
    '/agent/forgot-password',
    '/agent/forgot-password/',
    '/agent/FORGOT-PASSWORD',
    '/agent/forgot%2Dpassword',
    '/agent/forgot-password/step-2',
    '/agent/reset-password?token=abc',
    '/agent/reset-password/abc',
    '/agent/register',
    '/agent/register?ref=CODE',
    '/agent/ref/CODE',
    '/agent/login/google?code=abc',
  ])('%s lands on the Sign In form, with no way to recovery or sign-up', async (address) => {
    const { screen, waitFor, cleanup } = await open(address);
    close = cleanup;
    await waitFor(() => expect(window.location.pathname).toBe('/agent/login'), { timeout: 20000 });
    expect(await screen.findByLabelText('Username', {}, { timeout: 20000 })).toBeTruthy();
    expect(screen.queryByText('Reset your password')).toBeNull();
    expect(screen.queryByText(/forgot password/i)).toBeNull();
    expect(screen.queryByText(/create account/i)).toBeNull();
    expect(screen.queryByText(/continue with google/i)).toBeNull();
  }, 60000);

  it('leaves the main site its recovery page', async () => {
    const { screen, cleanup } = await open('/forgot-password');
    close = cleanup;
    expect(await screen.findByText('Reset your password', {}, { timeout: 20000 })).toBeTruthy();
    expect(window.location.pathname).toBe('/forgot-password');
  }, 60000);
});
