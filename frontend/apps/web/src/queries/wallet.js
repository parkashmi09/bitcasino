import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ENDPOINTS, path } from '@/lib/endpoints';
import { EVENTS, request } from '@/lib/socket';
import { refreshBalances } from '@/hooks/useWallet';
import { useAuth } from '@/auth/AuthProvider';

/**
 * The wallet's reads and its one write.
 *
 * ## The deposit address is socket-only, and that is not an oversight
 *
 * There is **no HTTP route** for it. `GET_ADDRESS` is a plain `SELECT` on
 * `wallets`, and the platform exposes it over the socket alone —
 * `docs/10-backend-integration.md` flags a `GET /user/crypto/addresses` player
 * route as a small follow-up so the drawer degrades when the socket is down.
 * Until then this is the only path, which is why it gets a real error state
 * rather than a spinner: a player looking at a blank address panel needs to
 * know whether it is loading, absent, or unreachable.
 *
 * ## `allocated: false` is an answer, not an error
 *
 * A coin with no address yet answers `{address: null, allocated: false}`
 * rather than inventing one. There is no generation path in the handler — it
 * does not call out to a wallet daemon — so an unallocated coin stays
 * unallocated until an operator provisions it. The drawer must say so plainly.
 *
 * **A player can send real money to whatever this screen shows.** That is the
 * whole reason nothing here is allowed to fall back to a plausible-looking
 * value: an address is money's destination, and a wrong one loses the deposit
 * with no way back.
 */

/** Query keys for wallet state, prefix-nested so a sign-out clears all of it. */
export const walletKeys = {
  all: ['wallet'],
  address: (coin, chain) => ['wallet', 'address', coin, chain ?? null],
  ledger: (limit, offset) => ['wallet', 'ledger', limit, offset],
  withdrawals: (limit, offset) => ['wallet', 'withdrawals', limit, offset],
  deposits: (limit, offset) => ['wallet', 'deposits', limit, offset],
  coins: () => ['wallet', 'coins'],
  swapQuote: (from, to, amount) => ['wallet', 'swap-quote', from, to, amount],
  vault: () => ['wallet', 'vault'],
  vaultTerms: () => ['wallet', 'vault-terms'],
};

/**
 * The player's deposit address for a coin.
 *
 * Returns `{address, allocated, chain}`. `allocated: false` with a null
 * address is the legitimate "no address provisioned" answer.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * `chain` IS NOT SENT, AND THAT IS DELIBERATE.
 *
 * `GET_ADDRESS` accepts a `chain` in its payload and filters the `wallets`
 * lookup by it — but **`wallets` has no `chain` column.** Passing one throws
 * inside the handler and the socket answers `SOCKET_HANDLER_FAILED`:
 *
 *     { coin: 'USDT' }                  -> { status: true, address: … }
 *     { coin: 'USDT', chain: 'TRC20' }  -> SOCKET_HANDLER_FAILED
 *
 * Verified against the running service on 2026-09-09.
 *
 * The deeper problem is not the 500. The table stores **one address per
 * (uid, coin)**, so a chain is not modelled at all — and USDT on TRC20 is a
 * different address from USDT on ERC20. Money sent to the wrong chain's
 * address is generally unrecoverable.
 *
 * So this asks for the coin only, and the caller must NOT present the answer
 * as belonging to whichever network the player happened to select. The drawer
 * shows the chain the SERVER reports, and says so plainly when the server
 * reports none. Filling that gap client-side would be inventing the one fact
 * on this screen that must never be invented.
 *
 * Both the crash and the modelling gap are flagged in
 * `docs/10-backend-integration.md` as backend work.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * @param {string} coin e.g. `USDT`
 * @param {object} [options]
 * @param {boolean} [options.enabled]
 */
export function useDepositAddress(coin, { enabled = true } = {}) {
  const { status } = useAuth();

  return useQuery({
    queryKey: walletKeys.address(coin, null),
    queryFn: () => request(EVENTS.GET_ADDRESS, { coin }),
    // Player-scoped. Asking as a visitor is a guaranteed refusal.
    enabled: enabled && status === 'authenticated' && Boolean(coin),
    /**
     * An address does not change. Once a coin is provisioned the row is
     * permanent, so re-reading it on every drawer open is pure noise — and the
     * one case that DOES change (`allocated: false` becoming true) is an
     * operator action a player is not sitting there waiting on.
     */
    staleTime: 60 * 60 * 1000,
    /**
     * One retry, not the default two. This is a socket round trip rather than
     * an HTTP request: if the connection is down, retrying immediately just
     * queues against the same dead transport. `SOCKET_TIMEOUT` already waited
     * 15 seconds to get here.
     */
    retry: 1,
  });
}

/**
 * The coins and chains the deposit picker offers.
 *
 * Public — a signed-out visitor may see what a site accepts before signing up.
 * Kept separate from `data/currencies.js`, which carries our own display
 * metadata (precision, colour); this is the platform's list of what it can
 * actually receive.
 */
export function useCryptoCoins() {
  return useQuery({
    queryKey: walletKeys.coins(),
    queryFn: ({ signal }) => api(ENDPOINTS.cryptoCoins, { auth: false, signal }),
    staleTime: 60 * 60 * 1000,
  });
}

/**
 * The player's wallet movements.
 *
 * **Offset-based** (`limit`/`offset`), unlike the catalogue's page/limit. The
 * validators are `.strict()`, so sending `page` here is a 422 rather than a
 * default — and a 422 on a list renders as an empty history, which is
 * indistinguishable from a player who has never transacted.
 */
export function useWalletLedger({ limit = 25, offset = 0, enabled = true } = {}) {
  const { status } = useAuth();

  return useQuery({
    queryKey: walletKeys.ledger(limit, offset),
    queryFn: ({ signal }) =>
      api(ENDPOINTS.walletLedger, { query: { limit, offset }, signal }),
    enabled: enabled && status === 'authenticated',
    staleTime: 30 * 1000,
  });
}

/** Submitted crypto withdrawals — what the player has asked for, and its state. */
export function useWithdrawals({ limit = 25, offset = 0, enabled = true } = {}) {
  const { status } = useAuth();

  return useQuery({
    queryKey: walletKeys.withdrawals(limit, offset),
    queryFn: ({ signal }) =>
      api(ENDPOINTS.withdrawalsCrypto, { query: { limit, offset }, signal }),
    enabled: enabled && status === 'authenticated',
    staleTime: 30 * 1000,
  });
}

/** Confirmed and pending deposits. */
export function useDeposits({ limit = 25, offset = 0, enabled = true } = {}) {
  const { status } = useAuth();

  return useQuery({
    queryKey: walletKeys.deposits(limit, offset),
    queryFn: ({ signal }) =>
      api(ENDPOINTS.historyDeposits, { query: { limit, offset }, signal }),
    enabled: enabled && status === 'authenticated',
    staleTime: 30 * 1000,
  });
}

/**
 * The deposit methods a PSP offers, as `[{ method, currency }]`.
 *
 * F2Pay is the one the cashier wires: `UpiMixed` in INR, `PI_USDT_TRX` in USDT.
 * A provider the owner has switched off answers `PAYORDER_PROVIDER_DISABLED`,
 * and an owner that allows none answers an empty list — both are "no rail here",
 * not a failure, so the error is swallowed to `[]` and the panel simply hides
 * itself rather than showing a scary state for a provider that was never meant
 * to be on. The shape and the disabled-answer are the hash reference's contract
 * (`GET /user/payments/methods/:provider`), confirmed against this backend's
 * `payment-orders` module.
 */
export function usePaymentMethods(provider, { enabled = true } = {}) {
  const { status } = useAuth();

  return useQuery({
    queryKey: ['wallet', 'payment-methods', provider],
    queryFn: () =>
      api(path(ENDPOINTS.paymentMethods, { provider })).then(
        (data) => (Array.isArray(data?.methods) ? data.methods : []),
        // Disabled / unconfigured / unreachable: offer nothing rather than err.
        () => [],
      ),
    enabled: enabled && status === 'authenticated' && Boolean(provider),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Create a PSP deposit order and get back where to pay.
 *
 * `POST /user/payments/deposits {provider, currency, amount, method?}` answers
 * `{reference, redirectUrl, …}`; the caller sends the player to `redirectUrl`
 * and the provider's signed callback is what credits the wallet — nothing is
 * filed here afterwards. The amount is a decimal STRING to the wire, never
 * `Number()`, for the reason the withdrawal note below gives. `retry: false`
 * stands (the client default): a deposit order is not idempotent.
 */
export function useCreateDeposit() {
  return useMutation({
    mutationFn: ({ provider, currency, amount, method }) =>
      api(ENDPOINTS.paymentDeposits, {
        method: 'POST',
        body: {
          provider,
          currency,
          amount: String(amount),
          ...(method ? { method } : {}),
        },
      }),
  });
}

/**
 * Submit a withdrawal.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THIS MOVES REAL MONEY, AND IT TAKES THE ACCOUNT PASSWORD.
 *
 * The password is verified against the hash server-side before anything moves
 * — legacy got that right and it is kept. Three rules follow for this client:
 *
 * 1. The password is passed straight through and **never stored**: not in a
 *    query key, not in the cache, not in a ref that outlives the submit. It is
 *    an argument to `mutate` and nothing else holds it.
 * 2. `retry: false`, inherited from the client's mutation default. A
 *    withdrawal is not idempotent — an automatic retry after a timeout is how
 *    one payout becomes two, and the server has no request-id to deduplicate
 *    on.
 * 3. The amount is a decimal STRING all the way to the wire. It is never
 *    parsed: `Number("0.00000001")` is fine but `Number` on a large balance is
 *    not, and a withdrawal is the worst place to discover a rounding error.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * On success the balances and the withdrawal list are invalidated, because
 * both changed and neither is refetched by anything else.
 */
export function useSubmitWithdrawal() {
  const client = useQueryClient();

  return useMutation({
    meta: { success: 'Withdrawal requested. You will be notified once it is processed.' },
    mutationFn: ({ coin, chain, amount, wallet, password }) =>
      request(EVENTS.SUBMIT_NEW_WITHDRAWL, {
        coin,
        amount: String(amount),
        wallet: String(wallet).trim(),
        password,
        ...(chain ? { chain } : {}),
      }),
    onSuccess: () => {
      // The balance moved and a pending row appeared. Neither is on a timer.
      client.invalidateQueries({ queryKey: walletKeys.all });
      /**
       * NOT `invalidateQueries(['balances'])`, which is what stood here and
       * did nothing. `useBalances` is a hand-rolled `useEffect` fetch rather
       * than a React Query hook, so it holds no cache entry for that key to
       * match — and an invalidation matching zero queries is silent. The
       * header chip kept the pre-withdrawal figure until the next remount.
       */
      refreshBalances();
    },
  });
}

/**
 * What a swap of `amount` would produce — `{converted, feeAmount,
 * feePercentage, …}`, all decimal strings (`feePercentage` a FRACTION:
 * `0.015` is 1.5%). The quote the confirm step shows; nothing moves here.
 */
export function useSwapQuote(from, to, amount, { enabled = true } = {}) {
  const { status } = useAuth();

  return useQuery({
    queryKey: walletKeys.swapQuote(from, to, amount),
    queryFn: ({ signal }) =>
      api(ENDPOINTS.swapEstimate, { query: { fromCurrency: from, toCurrency: to, amount }, signal }),
    enabled: enabled && status === 'authenticated' && Boolean(from && to && from !== to) && /[1-9]/.test(amount || ''),
    staleTime: 15 * 1000,
    retry: false,
  });
}

/** Place a swap. Not idempotent, so no retry (the client default). */
export function useSwap() {
  const client = useQueryClient();

  return useMutation({
    meta: { success: 'Swap complete.' },
    mutationFn: ({ from, to, amount }) =>
      api(ENDPOINTS.swap, {
        method: 'POST',
        body: { fromCurrency: from, toCurrency: to, amount: String(amount) },
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: walletKeys.all });
      refreshBalances();
    },
  });
}

/** The player's vault: `{totals: {COIN: "…"}, deposits: [{depositId, coin, balance, locked, endTime, …}]}`. */
export function useVault({ enabled = true } = {}) {
  const { status } = useAuth();

  return useQuery({
    queryKey: walletKeys.vault(),
    queryFn: ({ signal }) => api(ENDPOINTS.vault, { signal }),
    enabled: enabled && status === 'authenticated',
    staleTime: 30 * 1000,
  });
}

/**
 * The terms on offer, `[{value, label, days, rate}]` — `rate` an annual
 * PERCENTAGE (7.5 is 7.5%). Empty until an operator seeds `vault_lock_rates`,
 * and then the panel has nothing to deposit into and says so.
 */
export function useVaultTerms({ enabled = true } = {}) {
  const { status } = useAuth();

  return useQuery({
    queryKey: walletKeys.vaultTerms(),
    queryFn: ({ signal }) =>
      api(ENDPOINTS.vaultLockOptions, { signal }).then((rows) => (Array.isArray(rows) ? rows : [])),
    enabled: enabled && status === 'authenticated',
    staleTime: 5 * 60 * 1000,
  });
}

/** Wallet → vault (`{coin, amount, lockPeriod}`) or vault → wallet (`{coin, depositId}`). */
export function useVaultTransfer() {
  const client = useQueryClient();

  return useMutation({
    meta: { success: (_data, { direction }) => (direction === 'in' ? 'Moved to your vault.' : 'Moved back to your wallet.') },
    mutationFn: ({ direction, coin, amount, lockPeriod, depositId }) =>
      direction === 'in'
        ? api(ENDPOINTS.vaultTransferIn, { method: 'POST', body: { coin, amount: String(amount), lockPeriod } })
        : api(ENDPOINTS.vaultTransferOut, { method: 'POST', body: { coin, depositId } }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: walletKeys.all });
      refreshBalances();
    },
  });
}

/**
 * What still stands between the player and a withdrawal of `currency`:
 * `{ok, missing, kyc, wager, cap, dailyLimit, bonusForfeitRequired}` (hash `withdrawal.js`).
 * Read fresh each time the form opens; the backend enforces the same rules on submit.
 */
export function useWithdrawalRequirements(currency, { enabled = true } = {}) {
  return useQuery({
    queryKey: ['wallet', 'withdraw-requirements', currency],
    queryFn: ({ signal }) => api(ENDPOINTS.withdrawalRequirements, { query: { currency }, signal }),
    enabled: Boolean(currency) && enabled,
    staleTime: 0,
    retry: false,
  });
}

/** The player's saved payout addresses: `{whitelistOnly, addresses}`. */
export function useWhitelist({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['wallet', 'whitelist'],
    queryFn: ({ signal }) => api(ENDPOINTS.withdrawWhitelist, { signal }),
    enabled,
  });
}

/** Add / remove an address, or switch "withdraw only to saved addresses". */
export function useWhitelistChange() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ action, id, entry, enabled }) => {
      if (action === 'add') return api(ENDPOINTS.withdrawWhitelist, { method: 'POST', body: entry });
      if (action === 'remove') return api(path(ENDPOINTS.withdrawWhitelistItem, { id }), { method: 'DELETE' });
      return api(ENDPOINTS.withdrawWhitelistEnforcement, { method: 'PUT', body: { enabled } });
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['wallet', 'whitelist'] }),
  });
}

/** The house accounts for a manual deposit of `coin`; with `amount`, only those taking it. */
export const bankDetailsQuery = (coin, amount) => ({
  queryKey: ['wallet', 'bank-details', coin, amount ?? null],
  queryFn: ({ signal }) =>
    api(path(ENDPOINTS.bankDetails, { coin }), { query: amount ? { amount } : undefined, signal }).then((rows) =>
      Array.isArray(rows) ? rows : [],
    ),
});

export function useBankDetails(coin, { enabled = true } = {}) {
  return useQuery({ ...bankDetailsQuery(coin), enabled: Boolean(coin) && enabled });
}

/**
 * File a manual deposit: multipart, the destination's own fields, the reference and
 * the screenshot. Never retried: a second POST is a second claim.
 */
export function useSubmitFiatDeposit() {
  const client = useQueryClient();
  return useMutation({
    meta: { success: 'Deposit submitted. It is credited once it is approved.' },
    mutationFn: ({ fields, screenshot }) => {
      const form = new FormData();
      Object.entries(fields).forEach(([key, value]) => form.append(key, value));
      if (screenshot) form.append('screenshot', screenshot, screenshot.name);
      return api(ENDPOINTS.fiatDeposits, { method: 'POST', body: form });
    },
    onSuccess: () => client.invalidateQueries({ queryKey: walletKeys.all }),
  });
}
