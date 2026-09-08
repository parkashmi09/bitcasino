import { useEffect, useId, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { COUNTRIES, DIAL_CODES } from '@/data/countries';
import { LOCAL_FIELDS, useKyc, useProfile } from '@/hooks/useProfile';
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
 * The username, the email address, the phone number and the country come from
 * `GET /user/profile`; the country is written back through `PUT /user/profile`,
 * which is the only one of the nine form fields the platform has a column for.
 * The identity card is driven by `GET /user/kyc/status`. The rest of the form
 * persists in the browser — `useProfile` documents that split and holds the
 * seam. The one fabricated value is `emailVerified`, which no endpoint reports;
 * it is marked as a fixture where it is defined.
 *
 * `Start verification` and the resend button are the two controls with nothing
 * behind them: submitting KYC is a multipart document upload and resending a
 * verification email has no route at all. They are `aria-disabled` with a
 * title saying so, which is the rule the account menu's unbuilt rows follow —
 * told apart by what they do, not by how they look.
 */
export function Account() {
  const { profile, local, status, emailVerified, save, saving } = useProfile();
  const { kyc, status: kycStatus } = useKyc();

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
    setForm(seed(profile, local));
    // `local` is deliberately not a dependency: it changes on every save, and
    // re-seeding from it would overwrite whatever is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          {!emailVerified && <EmailNotice />}
          {kycStatus === 'ready' && kyc?.status !== 'Verified' && (
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

            <div className="flex items-center gap-2">
              <span className="truncate text-sm leading-6 text-trunks">
                {profile?.email ?? <Placeholder w="18ch" />}
              </span>
              {profile?.email && !emailVerified && (
                <Icon
                  name="warning"
                  size={24}
                  className="text-krillin"
                  role="img"
                  aria-label="Email address not confirmed"
                />
              )}
            </div>
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
              <fieldset disabled={!form || saving} className="grid gap-4 border-0 p-0">
                {/* Read-only on the reference too — a date of birth is set at
                    signup and changed by support, not here. */}
                <Fact label="Date of birth" value={formatBirthday(form?.dateOfBirth)} />

                <Field label="Name" placeholder="First name" value={form?.firstName} onChange={set('firstName')} autoComplete="given-name" />
                <Field label="Last name" placeholder="Last name" value={form?.lastName} onChange={set('lastName')} autoComplete="family-name" />

                {/* `max-content` for the code, the rest for the number, bottom
                    aligned so the two controls sit on one line while their
                    labels stay over each. */}
                <div className="grid grid-cols-[max-content_1fr] items-end gap-4">
                  <SelectField
                    label="Country Code"
                    value={form?.dialCode}
                    onChange={set('dialCode')}
                    options={DIAL_CODES.map((d) => ({ value: d.code, label: d.label }))}
                  />
                  <Field
                    label="Phone number"
                    value={form?.phone}
                    onChange={set('phone')}
                    type="tel"
                    autoComplete="tel-national"
                  />
                </div>

                <Field label="Line ID" placeholder="Line ID" value={form?.lineId} onChange={set('lineId')} />
                <Field label="Telegram ID" placeholder="Telegram ID" value={form?.telegramId} onChange={set('telegramId')} />
                <Field label="Address" placeholder="Address" value={form?.address} onChange={set('address')} autoComplete="street-address" />

                {/* Two equal columns at every width on the reference — no
                    responsive variant on its own `grid-cols-2`. */}
                <div className="grid grid-cols-2 gap-4">
                  <SelectField
                    label="Country"
                    value={form?.country}
                    onChange={set('country')}
                    options={COUNTRIES.map((c) => ({ value: c.name, label: c.name }))}
                  />
                  <Field label="City" placeholder="City" value={form?.city} onChange={set('city')} autoComplete="address-level2" />
                </div>

                <div className="grid w-max gap-4">
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
                </div>
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
 * The unconfirmed-address notice.
 *
 * Transparent, not a card — it sits on the page background above the identity
 * card. The resend control is INLINE in the paragraph on the reference, so it
 * flows after "spam folder or" rather than sitting on its own line, which is
 * why it is a `<button>` inside the `<p>` and not a row under it.
 */
function EmailNotice() {
  return (
    <div className="grid grid-cols-[min-content_auto] items-center gap-3 rounded-i-md p-3">
      <div className="grid size-10 place-items-center">
        <Icon name="alert" size={24} className="text-krillin" />
      </div>
      <p className="py-2 text-base leading-6 text-bulma">
        Please <b className="font-bold">verify your account</b> to enable withdrawals.
        We just sent you an email with a verification link – click it, and you&rsquo;re
        all set. No email received? Check your spam folder or{' '}
        <button
          type="button"
          aria-disabled="true"
          title="Resending the confirmation email is not built yet"
          className="rounded-i-sm bg-piccolo px-4 py-2 align-middle text-base leading-6 font-medium text-goten"
        >
          click here to resend.
        </button>
      </p>
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
        {/* Inert: submitting is a multipart document upload against
            `POST /user/kyc/submit`, which is its own screen. */}
        <span
          role="button"
          aria-disabled="true"
          title="Document upload is not built yet"
          className="rounded-i-sm bg-piccolo px-4 py-2 text-base leading-6 font-medium text-goten"
        >
          {state === 'Rejected' ? 'Resubmit documents' : 'Start verification'}
        </span>
        <a
          href="/terms"
          className="rounded-i-sm px-4 py-2 text-base leading-6 text-piccolo transition-colors hover:text-piccolo-120"
        >
          Terms &amp; Conditions
        </a>
      </div>
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

/** Label over input, 8px apart — the reference's `flex flex-col gap-2` field. */
function Field({ label, value, onChange, placeholder, type = 'text', autoComplete }) {
  const id = useId();
  return (
    <div className="flex w-full flex-col gap-2">
      <label htmlFor={id} className="text-base leading-6 text-trunks">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className={cn(
          'h-10 w-full min-w-0 rounded-i-sm border-[1.6px] border-hit bg-transparent px-2.5 py-1',
          'text-base leading-6 text-bulma outline-none transition-colors',
          'placeholder:text-trunks focus:border-piccolo disabled:opacity-60',
        )}
      />
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

/**
 * Splits the platform's single `phone` string into the reference's two fields,
 * and fills everything else from the browser-held half.
 *
 * The split runs only when the local half has nothing — once the player has
 * saved the form, their own two values win, because the platform cannot store
 * the split and re-deriving it would undo an edit on every reload.
 *
 * The longest dial code that matches wins: `+1` is a prefix of `+34` in string
 * terms only, but `+35` is a real prefix of `+351`, and picking the first
 * match would file a Portuguese number under Greece.
 */
function seed(profile, local) {
  const values = Object.fromEntries(LOCAL_FIELDS.map((f) => [f, local[f] ?? '']));
  values.country = profile.country ?? '';

  if (!values.dialCode && !values.phone && profile.phone) {
    const raw = String(profile.phone).trim();
    const match = DIAL_CODES.filter((d) => raw.startsWith(d.code)).sort(
      (a, b) => b.code.length - a.code.length,
    )[0];
    values.dialCode = match?.code ?? '';
    values.phone = match ? raw.slice(match.code.length).trim() : raw;
  }

  return values;
}

/**
 * `August 16, 2005` — the long form the reference prints, `en-US` pinned for
 * the reason `Notifications.formatDate` pins it.
 *
 * An em dash rather than an empty row when there is no date: the reference
 * always draws the row, and a caption with nothing under it reads as a bug.
 * Nothing sets this yet — signup collects a birthday and the platform has no
 * column for it, so it stays empty until one lands. See `useProfile`.
 */
function formatBirthday(iso) {
  if (!iso) return '—';
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** The line under the button. Empty until something has been submitted. */
function saveMessage(result) {
  if (!result) return '';
  if (result.ok) return 'Saved.';
  return result.error?.message ?? 'Could not save your changes. Please try again.';
}
