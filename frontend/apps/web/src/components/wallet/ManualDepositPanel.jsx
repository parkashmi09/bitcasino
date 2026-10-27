import { useId, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { useQueryClient } from '@tanstack/react-query';
import { bankDetailsQuery, useBankDetails, useSubmitFiatDeposit } from '@/queries/wallet';
import { manualDepositFields } from './withdrawRules';
import { cn } from '@/lib/cn';

const INPUT =
  'h-11 w-full rounded-i-sm border-[0.8px] border-beerus bg-goku px-3 text-sm text-bulma outline-none focus:border-piccolo';
const BUTTON =
  'h-11 w-full rounded-i-sm bg-piccolo text-sm font-medium text-on-piccolo transition-opacity hover:opacity-90 disabled:opacity-50';

/**
 * The manual deposit (hash `pages/Deposit/ManualDeposit.jsx`, behaviour only): the player
 * enters an amount, pays one of the house accounts the site admin set for it (Bank details),
 * then files the bank reference (UTR) or transaction hash and a screenshot. Staff approve it
 * and only then is the balance credited.
 *
 * Shown when the owner's `deposit_mode` allows manual and the site admin's switch is on
 * (`gates.manualDeposit()`). `quiet`: another deposit rail is also showing, so a coin with no
 * house account renders nothing instead of a warning.
 *
 * shortcut: the house account's QR image (`bank-details/:coin/:id/qr`, authenticated) is not
 * shown; the UPI ID / account number are copyable. Add it if admins rely on QR-only accounts.
 */
export function ManualDepositPanel({ currency, crypto = false, quiet = false }) {
  const coin = String(currency).toUpperCase();
  const [step, setStep] = useState(0);
  const [amount, setAmount] = useState('');
  const [asked, setAsked] = useState(null);
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState(0);
  const [reference, setReference] = useState('');
  const [file, setFile] = useState(null);
  const fileId = useId();

  const client = useQueryClient();
  const all = useBankDetails(coin);
  const submit = useSubmitFiatDeposit();

  const account = rows?.[picked];
  const positive = Number(amount) > 0;
  const ready = account && positive && reference.trim() && (file || crypto) && !submit.isPending;

  if (all.isPending) return quiet ? null : <p className="py-6 text-center text-sm text-trunks">Loading…</p>;
  if (!all.data?.length) {
    if (quiet) return null;
    return (
      <Notice tone="warning">
        {crypto
          ? `${coin} deposits are not available right now. Please try again later or contact support.`
          : `No ${coin} account is set up for deposits right now. Please try again later.`}
      </Notice>
    );
  }

  const send = async (event) => {
    event.preventDefault();
    if (!ready) return;
    try {
      await submit.mutateAsync({ fields: manualDepositFields({ amount, currency: coin, reference, account }), screenshot: file });
      setAmount('');
      setReference('');
      setFile(null);
      setAsked(null);
      setRows(null);
      setStep(3);
    } catch {
      // `submit.error` carries the backend's text; shown below.
    }
  };

  return (
    <form onSubmit={send} className="grid gap-3 rounded-i-md border-[0.8px] border-beerus bg-goku p-4">
      <p className="text-sm font-medium text-bulma">{crypto ? `Manual ${coin} transfer` : `Bank transfer (${coin})`}</p>

      {step === 3 ? (
        <>
          <Notice tone="success">Deposit submitted. Your balance is credited once it is approved.</Notice>
          <button type="button" className={BUTTON} onClick={() => setStep(0)}>
            Make another
          </button>
        </>
      ) : step === 0 ? (
        <>
          <p className="text-xs leading-relaxed text-trunks">
            {crypto
              ? `Enter the amount, send ${coin} to the address shown on its network, then enter the transaction hash.`
              : 'Enter the amount, transfer it to the account shown, then enter the bank reference (UTR) and upload the payment screenshot.'}
          </p>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-bulma">{`Amount (${coin})`}</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal"
              placeholder="0.00"
              className={cn(INPUT, 'tabular-nums')}
            />
          </label>
          {rows?.length === 0 && (
            <Notice tone="warning">{`No account takes a deposit of ${asked} ${coin} right now. Try a different amount.`}</Notice>
          )}
          <button
            type="button"
            className={BUTTON}
            disabled={!positive || loading}
            onClick={async () => {
              setLoading(true);
              setAsked(amount);
              try {
                const found = await client.fetchQuery({ ...bankDetailsQuery(coin, amount), staleTime: 0 });
                setRows(found);
                setPicked(0);
                if (found.length) setStep(1);
              } catch {
                setRows([]);
              } finally {
                setLoading(false);
              }
            }}
          >
            {loading ? 'Loading…' : 'Next'}
          </button>
        </>
      ) : (
        <>
          <span className="flex items-center justify-between text-xs text-trunks">
            <span>
              Amount <span className="font-medium text-bulma">{`${asked} ${coin}`}</span>
            </span>
            <button type="button" className="text-piccolo" onClick={() => setStep(step - 1)}>
              {step === 1 ? 'Change' : 'Back'}
            </button>
          </span>

          {step === 1 && account && (
            <>
              {rows.length > 1 && (
                <div className="grid grid-cols-2 gap-2">
                  {rows.map((row, index) => (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => setPicked(index)}
                      className={cn(
                        'h-10 rounded-i-sm text-xs font-medium',
                        index === picked ? 'bg-piccolo text-on-piccolo' : 'bg-beerus text-bulma',
                      )}
                    >
                      {row.network || (row.upiId && !row.accountNumber ? 'UPI' : row.bankName || `Account ${index + 1}`)}
                    </button>
                  ))}
                </div>
              )}
              <CopyRow label="Network" value={account.network} />
              <CopyRow label="Deposit address" value={account.walletAddress} />
              {account.walletAddress && (
                <Notice tone="warning">{`Send only ${coin} on the ${account.network} network. Anything else sent here is lost.`}</Notice>
              )}
              <CopyRow label="Bank" value={account.bankName} />
              {!account.walletAddress && <CopyRow label="Account holder" value={account.accountHolderName} />}
              <CopyRow label="Account number" value={account.accountNumber} />
              <CopyRow label="IFSC" value={account.ifscCode} />
              <CopyRow label="UPI ID" value={account.upiId} />
              <button type="button" className={BUTTON} onClick={() => setStep(2)}>
                {crypto ? 'I have sent it' : 'I have paid'}
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-bulma">{crypto ? 'Transaction hash' : 'Bank reference / UTR'}</span>
                <input value={reference} maxLength={128} onChange={(e) => setReference(e.target.value)} className={INPUT} />
              </label>
              <label htmlFor={fileId} className="grid gap-1.5">
                <span className="text-xs font-medium text-bulma">{`Payment screenshot${crypto ? ' (optional)' : ''}`}</span>
                <span className="flex h-20 cursor-pointer items-center justify-center rounded-i-sm border border-dashed border-beerus px-3 text-center text-xs text-trunks">
                  {file ? <span className="truncate font-medium text-bulma">{file.name}</span> : 'JPG, PNG or WebP'}
                </span>
              </label>
              <input
                id={fileId}
                type="file"
                className="hidden"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {submit.isError && <Notice tone="error">{submit.error?.message || 'The deposit was refused.'}</Notice>}
              <button type="submit" className={BUTTON} disabled={!ready}>
                {submit.isPending ? 'Submitting…' : 'Submit deposit'}
              </button>
            </>
          )}
        </>
      )}
    </form>
  );
}

function CopyRow({ label, value }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <div className="grid gap-1">
      <span className="text-[11px] text-trunks">{label}</span>
      <span className="flex items-center gap-2 rounded-i-sm bg-gohan px-3 py-2">
        <span className="min-w-0 flex-1 break-all font-mono text-xs text-bulma">{value}</span>
        <button
          type="button"
          aria-label={`Copy ${label}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* no clipboard permission: the value is on screen to copy by hand */
            }
          }}
          className="grid size-7 shrink-0 place-items-center rounded-i-xs text-trunks hover:text-bulma"
        >
          <Icon name={copied ? 'check' : 'copy'} size={16} />
        </button>
      </span>
    </div>
  );
}

function Notice({ tone, children }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : undefined}
      className={cn(
        'rounded-i-sm px-3 py-2 text-xs leading-relaxed text-bulma',
        tone === 'success' && 'bg-roshi/10',
        tone === 'warning' && 'bg-krillin/10',
        tone === 'error' && 'bg-dodoria/10',
      )}
    >
      {children}
    </p>
  );
}
