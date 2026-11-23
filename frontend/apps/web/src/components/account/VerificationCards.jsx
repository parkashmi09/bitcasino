import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { CodeField } from '@/components/ui/PasswordField';
import { FileField } from '@/components/account/KycDialog';
import {
  KYC_ACCEPTED_TYPES,
  KYC_MAX_BYTES,
  useConfirmEmailVerification,
  useKycLevels,
  useRequestEmailVerification,
  useSubmitKycLevel,
} from '@/queries/account';

/**
 * The two verification blocks of `/profile/account` beside the identity card, on the same
 * `gohan` card at the same 24px pad.
 */

/**
 * Verify the address on the account (`/email/verify/*`). The code goes to that address only and
 * is never in a response. Shown while the profile says `emailVerified: false`.
 */
export function EmailVerifyCard({ email, onVerified }) {
  const request = useRequestEmailVerification();
  const confirm = useConfirmEmailVerification();
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');

  async function send() {
    try {
      const answer = await request.mutateAsync();
      if (answer?.emailVerified) onVerified?.();
      else setSent(true);
    } catch {
      // `request.error` carries it.
    }
  }

  async function submit(event) {
    event.preventDefault();
    try {
      await confirm.mutateAsync(code);
      onVerified?.();
    } catch {
      setCode('');
    }
  }

  return (
    <div className="grid h-max gap-4 rounded-i-md bg-gohan p-6">
      <h2 className="font-primary text-xl leading-7 font-semibold tracking-normal text-bulma">
        Verify Email
      </h2>
      <p className="text-base leading-6 text-bulma">
        {sent
          ? `We sent a 6-digit code to ${email}. Enter it below.`
          : `Confirm that ${email} is yours. Some deposits need a verified email.`}
      </p>

      {sent ? (
        <form onSubmit={submit} className="grid gap-4">
          <CodeField
            label="Email code"
            value={code}
            onChange={setCode}
            error={confirm.isError ? confirm.error?.message : undefined}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" className="text-base" disabled={code.length !== 6 || confirm.isPending}>
              {confirm.isPending ? 'Checking…' : 'Verify'}
            </Button>
            <Button variant="ghost" className="text-base" onClick={send} disabled={request.isPending}>
              Send a new code
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <Button className="text-base" onClick={send} disabled={request.isPending}>
            {request.isPending ? 'Sending…' : 'Send code'}
          </Button>
        </div>
      )}

      {request.isError && (
        <p role="alert" className="text-sm leading-5 text-chichi">
          {request.error?.message || 'Could not send a code. Please try again.'}
        </p>
      )}
    </div>
  );
}

const STATUS_TONE = { Verified: 'positive', Pending: 'caution', Rejected: 'negative' };

/**
 * The verification ladder: identity KYC (levels 1-2) and the two document levels above it
 * (`GET /kyc-levels`). A level unlocks once the one under it is Verified; each takes one file.
 * Hidden while the site admin has levels off (`levelsOn: false`).
 */
export function KycLevelsCard() {
  const { data, isSuccess } = useKycLevels();
  if (!isSuccess || !data?.levelsOn) return null;

  const rows = [{ level: 2, label: 'Identity', unlocked: true, status: data.identity, fixed: true }, ...(data.levels ?? [])];

  return (
    <div className="grid h-max gap-4 rounded-i-md bg-gohan p-6">
      <h2 className="font-primary text-xl leading-7 font-semibold tracking-normal text-bulma">
        Verification Levels
      </h2>
      <ol className="grid gap-2">
        {rows.map((row) => (
          <LevelRow key={row.level} row={row} />
        ))}
      </ol>
    </div>
  );
}

function LevelRow({ row }) {
  const submit = useSubmitKycLevel();
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const canSend = !row.fixed && row.unlocked && row.status !== 'Pending' && row.status !== 'Verified';

  function pick(next) {
    setError(null);
    if (!next) return setFile(null);
    if (!KYC_ACCEPTED_TYPES.includes(next.type)) return setError('Use a JPEG, PNG or PDF file.');
    if (next.size > KYC_MAX_BYTES) return setError('The limit is 5 MB.');
    setFile(next);
  }

  async function send() {
    try {
      await submit.mutateAsync({ level: row.level, file });
      setFile(null);
    } catch (failure) {
      setError(failure?.message || 'The document was refused.');
    }
  }

  return (
    <li className="grid gap-3 rounded-i-sm bg-goku px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-base leading-6 text-bulma">
          <span className="text-trunks">{row.fixed ? 'Levels 1-2' : `Level ${row.level}`}</span> · {row.label}
        </span>
        {row.status ? (
          <Badge tone={STATUS_TONE[row.status] ?? 'neutral'}>{row.status}</Badge>
        ) : (
          <span className="text-xs text-trunks">{row.unlocked ? 'Not sent' : 'Locked'}</span>
        )}
      </div>
      {row.rejectionReason && <p className="text-sm leading-5 text-chichi">{row.rejectionReason}</p>}
      {!row.fixed && !row.unlocked && (
        <p className="text-xs leading-4 text-trunks">Unlocks once level {row.level - 1} is verified.</p>
      )}
      {canSend && (
        <>
          <FileField label="Document" file={file} onChange={pick} error={error} />
          <div>
            <Button onClick={send} disabled={!file || submit.isPending}>
              {submit.isPending ? 'Sending…' : row.status === 'Rejected' ? 'Send again' : 'Send document'}
            </Button>
          </div>
        </>
      )}
    </li>
  );
}
