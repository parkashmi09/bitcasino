import { useId, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Skeleton } from '@/components/ui/Skeleton';
import { CodeField, PasswordField } from '@/components/ui/PasswordField';
import { useAvatars } from '@/queries/siteConfig';
import {
  useChangeEmail,
  useProfileStats,
  usePublicProfile,
  useRequestEmailChangeCode,
  useSetAvatar,
} from '@/queries/account';
import { formatBalance } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * The profile blocks of `/profile/account`: lifetime play, the avatar picker, the email change
 * and the public card. Same `gohan` card at the same 24px pad as the verification blocks.
 */

const dateOf = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString() : '—';
};

/** The picture in `users.avatar`, else the name's initial on `goku`. */
export function Avatar({ src, name, className }) {
  return src ? (
    <img src={src} alt="" className={cn('shrink-0 rounded-full bg-goku object-cover', className)} />
  ) : (
    <span
      aria-hidden="true"
      className={cn('grid shrink-0 place-items-center rounded-full bg-goku font-semibold text-bulma uppercase', className)}
    >
      {String(name ?? '?').slice(0, 1)}
    </span>
  );
}

function Stat({ label, value }) {
  return (
    <div className="grid gap-0.5 rounded-i-sm bg-goku px-3 py-2">
      <span className="text-xs leading-4 text-trunks">{label}</span>
      <span className="truncate text-base leading-6 font-semibold text-bulma tabular-nums">{value}</span>
    </div>
  );
}

/** `GET /profile/stats`: the player's own lifetime play across casino and sports. */
export function ProfileStatsCard() {
  const { data, isPending, isError, refetch } = useProfileStats();

  return (
    <div className="grid h-max gap-4 rounded-i-md bg-gohan p-6">
      <h2 className="font-primary text-xl leading-7 font-semibold tracking-normal text-bulma">Your play</h2>
      {isPending ? (
        <div className="grid grid-cols-2 gap-2">
          {[0, 1, 2, 3].map((cell) => (
            <Skeleton key={cell} className="h-14 rounded-i-sm" />
          ))}
        </div>
      ) : isError ? (
        <p className="text-sm text-chichi">
          Could not load your stats.{' '}
          <button type="button" onClick={() => refetch()} className="cursor-pointer font-medium text-piccolo hover:underline">
            Try again
          </button>
        </p>
      ) : !data?.bets ? (
        <p className="text-sm text-trunks">No bets yet. Your stats appear here after your first bet.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Bets" value={data.bets.toLocaleString()} />
            <Stat label="Wins" value={data.wins.toLocaleString()} />
            <Stat label="Win rate" value={data.winRate ? `${data.winRate}%` : '—'} />
            <Stat label="Wagered" value={`$${formatBalance(data.wagered?.usd ?? '0', 2)}`} />
          </div>
          {data.biggestWin && (
            <p className="text-sm leading-5 text-trunks">
              Biggest win{' '}
              <span className="font-semibold text-bulma tabular-nums">
                {formatBalance(data.biggestWin.amount ?? '0', 2)} {data.biggestWin.currency}
              </span>
              {data.biggestWin.game && ` on ${data.biggestWin.game}`}
            </p>
          )}
          {data.favouriteGames?.length > 0 && (
            <div className="grid gap-2">
              <p className="text-[10px] leading-4 tracking-[0.5px] text-bulma uppercase">Favourite games</p>
              <ol className="grid gap-1">
                {data.favouriteGames.map((game) => (
                  <li key={game.key} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-bulma">{game.name}</span>
                    <span className="shrink-0 text-trunks tabular-nums">{game.bets} bets</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <p className="text-xs leading-4 text-trunks">
            First bet {dateOf(data.firstBetAt)} · last bet {dateOf(data.lastBetAt)}
          </p>
        </>
      )}
    </div>
  );
}

/** The admin's avatar set; one above the player's VIP level shows its level and cannot be picked. */
export function AvatarDialog({ open, onClose, profile, onChanged }) {
  const avatars = useAvatars({ enabled: open });
  const setAvatar = useSetAvatar();
  const level = Number(profile?.vipLevel ?? 0);

  async function pick(avatar) {
    try {
      await setAvatar.mutateAsync(avatar.id);
      onChanged?.();
      onClose();
    } catch {
      // `setAvatar.error` carries it.
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Choose an avatar" width="max-w-[520px]">
      {avatars.isPending ? (
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-5">
          {Array.from({ length: 10 }, (_, cell) => (
            <Skeleton key={cell} className="aspect-square rounded-full" />
          ))}
        </div>
      ) : avatars.isError ? (
        <p className="text-sm text-chichi">Could not load the avatars. Close this and try again.</p>
      ) : avatars.data.length === 0 ? (
        <p className="text-sm text-trunks">No avatars are available yet.</p>
      ) : (
        <ul className="grid grid-cols-4 gap-3 sm:grid-cols-5">
          {avatars.data.map((avatar) => {
            const locked = Number(avatar.minLevel ?? 0) > level;
            const current = profile?.avatar === avatar.url;
            return (
              <li key={avatar.id}>
                <button
                  type="button"
                  disabled={locked || setAvatar.isPending}
                  onClick={() => pick(avatar)}
                  aria-pressed={current}
                  aria-label={locked ? `Avatar, unlocks at VIP level ${avatar.minLevel}` : 'Avatar'}
                  className={cn(
                    'relative grid w-full cursor-pointer place-items-center rounded-full p-0.5 transition-colors',
                    current ? 'bg-piccolo' : 'hover:bg-heles',
                    'disabled:cursor-default',
                  )}
                >
                  <img src={avatar.url} alt="" className={cn('aspect-square w-full rounded-full object-cover', locked && 'opacity-40')} />
                  {locked && (
                    <span className="absolute inset-x-0 bottom-0 mx-auto w-max rounded-full bg-goku px-1.5 text-[10px] leading-4 text-bulma">
                      VIP {avatar.minLevel}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {setAvatar.isError && (
        <p role="alert" className="text-sm text-chichi">
          {setAvatar.error?.message || 'That avatar could not be set.'}
        </p>
      )}
    </Dialog>
  );
}

/**
 * Two steps: a `change-email` code to the NEW address, then that code plus the current
 * password (`POST /profile/change-email`). One code authorises one change.
 */
export function ChangeEmailDialog({ open, onClose, onChanged }) {
  const request = useRequestEmailChangeCode();
  const change = useChangeEmail();
  const emailId = useId();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function send(event) {
    event?.preventDefault();
    try {
      await request.mutateAsync(email.trim());
      setSent(true);
    } catch {
      // `request.error` carries it.
    }
  }

  async function submit(event) {
    event.preventDefault();
    try {
      await change.mutateAsync({ email: email.trim(), code, password });
      onChanged?.();
      onClose();
    } catch {
      setCode('');
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Change email">
      {!sent ? (
        <form onSubmit={send} className="grid gap-4">
          <div className="grid gap-2">
            <label htmlFor={emailId} className="text-base leading-6 text-trunks">
              New email
            </label>
            <input
              id={emailId}
              type="email"
              value={email}
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
              className="h-10 w-full min-w-0 rounded-i-sm border-[1.6px] border-hit bg-transparent px-2.5 text-base leading-6 text-bulma outline-none transition-colors focus:border-piccolo"
            />
          </div>
          <p className="text-sm leading-5 text-trunks">We send a 6-digit code to the new address to prove it is yours.</p>
          <Button type="submit" disabled={!valid || request.isPending}>
            {request.isPending ? 'Sending…' : 'Send code'}
          </Button>
        </form>
      ) : (
        <form onSubmit={submit} className="grid gap-4">
          <p className="text-sm leading-5 text-bulma">Enter the code we sent to {email.trim()} and your current password.</p>
          <CodeField label="Email code" value={code} onChange={setCode} />
          <PasswordField label="Current password" value={password} onChange={setPassword} autoComplete="current-password" />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={code.length !== 6 || !password || change.isPending}>
              {change.isPending ? 'Saving…' : 'Change email'}
            </Button>
            <Button variant="ghost" onClick={() => send()} disabled={request.isPending}>
              Send a new code
            </Button>
          </div>
        </form>
      )}
      {(request.isError || change.isError) && (
        <p role="alert" className="text-sm leading-5 text-chichi">
          {(change.error ?? request.error)?.message || 'That did not work. Please try again.'}
        </p>
      )}
    </Dialog>
  );
}

/** What other players see: `GET /profile/:userId/public`. Counts are null when the player hides them. */
export function PlayerCardDialog({ open, onClose, userId }) {
  const { data, isPending, isError } = usePublicProfile(userId, { enabled: open });

  return (
    <Dialog open={open} onClose={onClose} title="Public profile">
      {isPending ? (
        <div className="grid gap-3">
          <Skeleton className="h-16 rounded-i-sm" />
          <Skeleton className="h-14 rounded-i-sm" />
        </div>
      ) : isError ? (
        <p className="text-sm text-chichi">This profile could not be loaded.</p>
      ) : (
        <div className="grid gap-4">
          <div className="flex items-center gap-3">
            <Avatar src={data.avatar} name={data.username || '?'} className="size-14 text-xl" />
            <div className="grid min-w-0">
              {/* `usernameHidden`: the player keeps the name private and the server sends null. */}
              <span className="truncate text-lg leading-7 font-semibold text-bulma">
                {data.usernameHidden || !data.username ? 'Hidden' : data.username}
              </span>
              <span className="flex items-center gap-1.5 text-sm text-trunks">
                {data.badgeUrl && <img src={data.badgeUrl} alt="" className="size-4" />}
                {data.levelName || `VIP ${data.level ?? 0}`}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Joined" value={dateOf(data.joinedAt)} />
            <Stat label="Bets" value={data.statisticsHidden ? 'Hidden' : (data.bets ?? '—')} />
            <Stat label="Wins" value={data.statisticsHidden ? 'Hidden' : (data.wins ?? '—')} />
          </div>
        </div>
      )}
    </Dialog>
  );
}
