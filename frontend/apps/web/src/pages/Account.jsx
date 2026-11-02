import { useEffect, useId, useState } from 'react';
import { KycDialog } from '@/components/account/KycDialog';
import { COUNTRIES } from '@/data/countries';
import { useProfile } from '@/hooks/useProfile';
import { useGates } from '@/hooks/useGates';
import { useKycStatus } from '@/queries';
import { cn } from '@/lib/cn';

/**
 * `/profile/account`.
 *
 * Two blocks: the player's record and the form over it, and — beside it on a
 * wide screen, above it on anything narrower — the verification column.
 *
 * Every number below was read off `bitcasino.io/profile/account` itself, with
 * `getBoundingClientRect` and `getComputedStyle` on each piece, by the
 * procedure in `docs/11-comparing-against-the-reference.md`:
 *
 *   page          `grid gap-2`, with 8px above the heading — the ONE account
 *                 page that has it; Notifications puts its `h1` flush against
 *                 the tab bar at y=154 and this one starts at y=162
 *   heading       24px/32, weight 400, `bulma` — DM Sans, not the display face
 *   columns       `grid gap-2`, one column, KYC first
 *   info card     `gohan`, 12px radius, 16px pad, 16px between its blocks
 *   username      24px/32, weight 400
 *   email         14px/24 `trunks` beside a 24px `krillin` warning mark
 *   rule          1px `beerus`, full card width
 *   caption       10px/16, uppercase, 0.5px tracking, `bulma`
 *   form          `grid gap-4`
 *   field         label 16px/24 `trunks` over a 40px input, 8px apart
 *   input         transparent, 1.6px `hit` border, 8px radius, 4px/10px pad
 *   select        transparent-on-`gohan`, 0.8px `beerus` border, 8px radius
 *   fact          12px/16 `trunks` caption over 16px/24 semibold `bulma`
 *   save          40px, transparent, a 1px `trunks` INSET ring, 16px/24 medium
 *   notice        transparent, 12px pad, a 40px icon slot 12px from the text
 *   kyc card      `gohan`, 12px radius, 24px pad, 16px between its blocks
 *   kyc heading   20px/28, weight 600
 *
 * ## The two-column switch is at 1500px, and it is the reference's own number
 *
 * Read from its stylesheet rather than guessed:
 *
 *   .container       { display: grid; gap: .5rem;
 *                      grid-template-areas: "kyc" "info" }
 *   @media (min-width: 1500px) {
 *     .container     { grid-template-areas: "info kyc";
 *                      grid-template-columns: minmax(48rem, 1fr) 1fr } }
 *
 * 1500 is not one of this project's breakpoints (640/768/1024/1200/1536), so
 * it is written as a raw media query the way `SearchDialog`'s 1280/1440/1536
 * steps are — inventing a token for a one-off would put a number in the theme
 * that nothing else uses.
 *
 * The swap is done with `order`, not `grid-template-areas`. It is the same
 * result: CSS grid auto-placement follows order-modified document order, so
 * the form takes the first track and the verification column the second. The
 * DOM keeps the reference's own order — KYC first — at every width, which is
 * also the order it is read in when the columns are stacked.
 *
 * `minmax(48rem, 1fr) 1fr` is why the switch needs 1500px rather than 1200: at
 * 1536 the content column is 1201px, and the form's 768px floor leaves 425 for
 * the verification card. Below that the form would be squeezed under its own
 * minimum and the two columns would overflow.
 *
 * ## What is real
 *
 * Everything shown comes from `GET /user/profile`: username, email, phone
 * (read-only) and country, which `PUT /user/profile` saves. Fields the platform
 * has no column for (birthday, names, address, Telegram…) are not drawn, and
 * neither is an email-verification notice — no route reports or resends one.
 * The identity card is driven by `GET /user/kyc/status`; `Start verification`
 * opens the real multipart submission (`components/account/KycDialog.jsx`).
 */
export function Account() {
  const { profile, status, save, saving } = useProfile();
  const { data: kyc, isSuccess: kycRead } = useKycStatus();
  // An agent's player: read-only, no email or contact fields — the site admin edits
  // their profile (backend PROFILE_EDIT_NOT_FOR_AGENT_USERS).
  const gates = useGates();
  const { agentPlayer } = gates;

  const [form, setForm] = useState(null);
  const [result, setResult] = useState(null);

  /**
   * Seed the form once the record lands, and again if it is reloaded.
   *
   * `profile` is the dependency rather than a `status` string because the
   * fields come from it; keying on `'ready'` would not re-seed after a save
   * that changed the country server-side.
   */
  useEffect(() => {
    if (!profile) return;
    setForm({ country: profile.country ?? '' });
  }, [profile]);

  const set = (field) => (value) => {
    setForm((previous) => ({ ...previous, [field]: value }));
    setResult(null);
  };

  async function onSubmit(event) {
    event.preventDefault();
    setResult(await save(form));
  }

  return (
    // The 8px above the heading is this page's, not the account area's — see
    // the note above. `ProfileLayout` gives every page a flush tab bar.
    <div className="grid gap-2 pt-2">
      <h1 className="font-primary text-2xl font-normal tracking-normal text-bulma">
        Account
      </h1>

      <div className="grid gap-2 [@media(min-width:1500px)]:grid-cols-[minmax(48rem,1fr)_1fr]">
        {/* KYC column. First in the DOM at every width, second on screen once
            the columns split — see the note above. */}
        <div className="grid h-max gap-2 [@media(min-width:1500px)]:order-2">
          {gates.on('kyc') && kycRead && kyc?.status !== 'Verified' && (
            <IdentityCard kyc={kyc} />
          )}
        </div>

        <div className="grid h-max gap-4 rounded-i-md bg-gohan p-4 [@media(min-width:1500px)]:order-1">
          <div className="grid gap-4">
            <div>
              {/* `h2`, not `h3`: the page's `h1` is the only heading above it.
                  The reference uses an `h3` under an `h1` with no `h2`, which
                  is a gap in its outline rather than something to copy. */}
              <h2 className="truncate font-primary text-2xl leading-8 font-normal tracking-normal text-bulma">
                {profile?.username ?? <Placeholder w="10ch" />}
              </h2>
            </div>

            {!agentPlayer && <div className="flex items-center gap-2">
              <span className="truncate text-sm leading-6 text-trunks">
                {profile?.email ?? <Placeholder w="18ch" />}
              </span>
            </div>}
          </div>

          <hr className="h-px border-0 bg-beerus" />

          {/* 10px uppercase on half a pixel of tracking. `uppercase` in CSS
              rather than in the string, so a screen reader reads a word and
              not an initialism. */}
          <p className="text-[10px] leading-4 tracking-[0.5px] text-bulma uppercase">
            Personal info
          </p>

          {status === 'error' ? (
            <p className="text-sm text-chichi">
              Could not load your profile. Reload the page to try again.
            </p>
          ) : (
            <form onSubmit={onSubmit}>
              <fieldset disabled={!form || saving || agentPlayer} className="grid gap-4 border-0 p-0">
                {/* Only what the platform stores: the phone from signup (read-only,
                    `PUT /user/profile` has no phone) and the country, which it does save. */}
                {!agentPlayer && profile?.phone && <Fact label="Phone number" value={profile.phone} />}

                {/* Two equal columns at every width on the reference — no
                    responsive variant on its own `grid-cols-2`. */}
                <div className="grid grid-cols-2 gap-4">
                  <SelectField
                    label="Country"
                    value={form?.country}
                    onChange={set('country')}
                    options={COUNTRIES.map((c) => ({ value: c.name, label: c.name }))}
                  />
                </div>

                {!agentPlayer && <div className="grid w-max gap-4">
                  <button
                    type="submit"
                    className={cn(
                      'h-10 cursor-pointer rounded-i-sm px-4 py-2 text-base leading-6 font-medium text-bulma',
                      // A 1px INSET ring, not a border: the reference's control
                      // is `box-shadow: inset 0 0 0 1px trunks`, which keeps the
                      // 40px box the same as the filled buttons beside it.
                      'shadow-[inset_0_0_0_1px_rgb(var(--trunks))] transition-colors',
                      'hover:bg-heles disabled:cursor-default disabled:opacity-50',
                    )}
                  >
                    {saving ? 'Saving…' : 'Save changes'}
                  </button>
                </div>}
              </fieldset>

              {/* The reference gives no feedback here at all. This does, and
                  that is a deliberate difference: `PUT /user/profile` really
                  can fail — a country over 100 characters is a 422 — and a
                  form that says nothing either way leaves the player guessing
                  whether it saved. `docs/11` records it. */}
              <p
                aria-live="polite"
                className={cn(
                  'min-h-5 pt-2 text-sm leading-5',
                  result && !result.ok ? 'text-chichi' : 'text-trunks',
                )}
              >
                {saveMessage(result)}
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The identity-verification card.
 *
 * Shown for every KYC state except `Verified` — a verified account has no card
 * here on the reference either. `Pending` and `Rejected` keep the card but
 * change its closing line, because "verify your account to continue" is wrong
 * advice for somebody whose documents are already in the queue.
 */
function IdentityCard({ kyc }) {
  const state = kyc?.status ?? 'NotSubmitted';
  const [open, setOpen] = useState(false);

  const closing =
    state === 'Pending'
      ? 'Your documents are with us. We will email you when the review is done.'
      : state === 'Rejected'
        ? kyc?.rejectionReason
          ? `Your last submission was rejected: ${kyc.rejectionReason}`
          : 'Your last submission was rejected. Please submit your documents again.'
        : 'Please verify your account to continue.';

  return (
    <div className="grid h-max gap-4 rounded-i-md bg-gohan p-6">
      <h2 className="font-primary text-xl leading-7 font-semibold tracking-normal text-bulma">
        Verify Identity
      </h2>

      <p className="text-base leading-6 text-bulma">
        Identity verification keeps your account more secure. We use our trusted
        partners for automatic identity verification. For a successful
        verification, be prepared to provide the following documents: – Identity
        documents: National ID card, passport or driver&rsquo;s license
      </p>

      <p className="text-base leading-6 text-bulma">{closing}</p>

      <div className="flex flex-wrap items-center gap-2">
        {/* Real as of Phase 6 — a multipart submission against
            `POST /user/kyc/submit`. `Pending` is the one state with no button:
            the documents are already with a human, and a second submission
            queues the same review twice. */}
        {state === 'Pending' ? (
          <span className="rounded-i-sm bg-beerus px-4 py-2 text-base leading-6 font-medium text-trunks">
            Under review
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="cursor-pointer rounded-i-sm bg-piccolo px-4 py-2 text-base leading-6 font-medium text-on-piccolo transition-opacity hover:opacity-90"
          >
            {state === 'Rejected' ? 'Resubmit documents' : 'Start verification'}
          </button>
        )}
        <a
          href="/terms"
          className="rounded-i-sm px-4 py-2 text-base leading-6 text-piccolo transition-colors hover:text-piccolo-120"
        >
          Terms &amp; Conditions
        </a>
      </div>

      <KycDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

/** A 12px caption over a 16px semibold value — the form's read-only rows. */
function Fact({ label, value }) {
  return (
    <div className="grid">
      <span className="text-xs leading-4 text-trunks">{label}</span>
      <span className="text-base leading-6 font-semibold text-bulma">{value}</span>
    </div>
  );
}

/**
 * The same field with a native `<select>`.
 *
 * Native, not the project's `Select`: that one is a popover listbox built for
 * the game-list filter bar, and the reference's account form uses plain
 * `<select>` elements with the platform's own chrome — thinner border,
 * `gohan` fill. A 250-row country list is also exactly the case where the
 * native control earns its keep, on a phone especially.
 */
function SelectField({ label, value, onChange, options }) {
  const id = useId();
  return (
    <div className="flex w-full flex-col gap-2">
      <label htmlFor={id} className="text-base leading-6 text-trunks">
        {label}
      </label>
      <select
        id={id}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          'h-10 w-full min-w-0 rounded-i-sm border-[0.8px] border-beerus bg-gohan px-2',
          'text-base leading-6 text-bulma outline-none transition-colors',
          'focus:border-piccolo disabled:opacity-60',
        )}
      >
        {/* The empty first row the reference shows before a choice is made. */}
        <option value="" />
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** A dash of the right width while the record is still in flight. */
function Placeholder({ w }) {
  return (
    <span aria-hidden="true" className="inline-block align-middle" style={{ width: w }}>
      &nbsp;
    </span>
  );
}

/** The line under the button. Empty until something has been submitted. */
function saveMessage(result) {
  if (!result) return '';
  if (result.ok) return 'Saved.';
  return result.error?.message ?? 'Could not save your changes. Please try again.';
}
