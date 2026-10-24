import { useNotifications } from '@/hooks/useNotifications';
import { cn } from '@/lib/cn';

/**
 * `/profile/notifications`.
 *
 * This is a PAGE, not a dropdown. The reference's bell is a link to
 * `/profile/notifications` — read off its own header, where the control is an
 * `<a href="/profile/notifications">` rather than a menu trigger — and this
 * project used to open a panel from it, which is why the two looked nothing
 * alike.
 *
 * Measured off the reference at a 1536px viewport, with the account signed in:
 *
 *   column       750px max — this page's own, not the account area's
 *   stack        `grid gap-2` — 8px between the heading, the action and the list
 *   heading      24px/32, weight 400, `bulma` — DM Sans, NOT the display face
 *                the rest of the site's headings use
 *   action       16px `piccolo`, no underline until hover
 *   row          message 14px/21 `bulma`, then the date, then a hairline
 *   date         12px/16, `uppercase`, 0.3px tracking
 *   rule         1px `beerus`, full column width
 *
 * The row carries NO padding and no gaps: 21 + 16 + 1 = the 38px the reference
 * measures. The air between rows is the hairline's own, which is why the rule
 * belongs to the row above it rather than sitting between rows.
 *
 * The date is `bulma`, not `trunks`. It LOOKS grey on the reference and it is
 * not — `getComputedStyle` says `rgb(0,0,0)` at opacity 1, and what reads as
 * grey is 12px uppercase on 0.3px tracking. Worth knowing before somebody
 * "fixes" it to a muted token.
 *
 * The unread dot is ours; see the comment on the row for what the reference
 * does and why this does not copy it.
 */
export function Notifications() {
  const { items, unread, markAllRead, isPending, isError } = useNotifications();

  return (
    // 750px is the reference's reading column for this page. It lives here
    // rather than on `ProfileLayout`'s outlet because it is this page's
    // measurement, not the account area's — see the note there.
    <div className="grid max-w-[750px] gap-2">
      {/* `font-primary` and `tracking-normal` both undo the base `h1` rule,
          which sets the display face and -0.01em. The reference's account
          headings are plain DM Sans at 24/32 with no tracking. */}
      <h1 className="font-primary text-2xl font-normal tracking-normal text-bulma">
        Notifications
      </h1>

      {/* The reference shows this whether or not anything is unread. It is a
          plain text button, not a `Button` — 16px `piccolo` on the page
          background with no box around it. */}
      <div>
        <button
          type="button"
          onClick={markAllRead}
          disabled={unread === 0}
          className={cn(
            'text-base text-piccolo transition-colors',
            unread === 0
              ? 'cursor-default opacity-50'
              : 'cursor-pointer hover:text-piccolo-120 hover:underline',
          )}
        >
          Mark all as read
        </button>
      </div>

      {/**
        * Three states that all render as no rows, told apart.
        *
        * Until Phase 8 the list came from a fixture and could only ever be
        * full, so one empty line covered everything. A real read can be
        * mid-flight, refused, or genuinely empty, and "Nothing here yet" is
        * a lie in the first two — the second especially, where a player would
        * conclude the operator has said nothing when in fact the feed is
        * down.
        *
        * No skeleton: this is a short list of plain lines, and a shimmer
        * standing in for three sentences is more motion than the wait
        * deserves.
        */}
      {isPending ? (
        <p className="pt-2 text-sm text-trunks">Loading…</p>
      ) : isError ? (
        <p className="pt-2 text-sm text-trunks">
          Could not load your notifications. Try again in a moment.
        </p>
      ) : items.length === 0 ? (
        <p className="pt-2 text-sm text-trunks">Nothing here yet.</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.id} className="relative">
              {/* The dot hangs in the gutter, not in the text column. The
                  reference keeps a zero-height slot above a read message, so
                  its unread form pushes the row DOWN — but it was collapsed on
                  the account we measured, so its content is unknowable. This
                  keeps the one thing that IS measured exact: the message's
                  left edge at the column start whether read or not. `main`'s
                  padding is 32px from `md` up and 16px below it, so a 14px
                  overhang stays inside the page either way. */}
              {!item.read && (
                <span
                  aria-hidden="true"
                  className="absolute -start-3.5 top-[7px] size-1.5 rounded-full bg-piccolo"
                />
              )}
              <div className="text-sm leading-[21px] text-bulma">{item.body}</div>
              <p className="text-xs leading-4 tracking-[0.3px] text-bulma uppercase">
                {formatDate(item.at)}
              </p>
              <hr className="h-px border-0 bg-beerus" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * `WEDNESDAY, SEPTEMBER 3, 2026` — the long form the reference prints, with the
 * uppercasing left to CSS so the DOM keeps a readable string for a screen
 * reader.
 *
 * `en-US` is pinned rather than left to the visitor's locale: the reference
 * serves this format to everyone, and a browser set to `en-GB` would otherwise
 * render `03 September 2026` here and nowhere else on the site.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * THE STRING IS A FULL TIMESTAMP NOW, AND IT USED TO BE A DATE.
 *
 * This read `new Date(`${iso}T00:00:00`)` while the rows came from a fixture
 * whose `at` was `'2026-09-07'`. The platform's `date` column is
 * `timestamptz` and arrives as `2026-09-07T13:19:06.538Z`, so appending the
 * midnight suffix produced `…538ZT00:00:00`, which is an Invalid Date — and
 * the guard below turned every date on the page into an empty line rather
 * than an error anybody would notice.
 *
 * `Date` parses both forms unaided, so nothing is appended. The one thing
 * that changes is the timezone rule: a bare `YYYY-MM-DD` is parsed as UTC and
 * a full timestamp is converted to the viewer's zone, which is right — a
 * notice posted at 23:30 UTC should read as the next day for a player who is
 * three hours ahead of it.
 * ═══════════════════════════════════════════════════════════════════════
 */
function formatDate(iso) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
