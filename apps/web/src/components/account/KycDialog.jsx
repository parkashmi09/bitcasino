import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Icon } from '@/components/ui/Icon';
import { COUNTRIES } from '@/data/countries';
import {
  KYC_ACCEPTED_TYPES,
  KYC_MAX_BYTES,
  useSubmitKyc,
} from '@/queries';
import { cn } from '@/lib/cn';

/**
 * The identity submission — `POST /user/kyc/submit`.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE ONE MULTIPART POST IN THE APP, AND THE HEADER IS THE TRAP.
 *
 * A multipart body is `multipart/form-data; boundary=…` and only the browser
 * knows the boundary it generated. Setting the content-type ourselves sends
 * the type with no boundary and multer has nothing to split on. Measured
 * against the running service, the same body answers **500 INTERNAL_ERROR**
 * with the header and **201** without it — a failure that reads as a broken
 * endpoint rather than a malformed request. `api.js` omits the header on a
 * `FormData` body for exactly this reason; see the note there.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * ## What the server actually accepts, which is not what `docs/10` said
 *
 * Read from `kyc.constants.js` rather than from the plan, which had all three
 * wrong:
 *
 *   files       up to THREE — `idFront`, `idBack`, `passport` (not one)
 *   types       JPEG, PNG and **PDF** (not WebP)
 *   ceiling     **5 MB** each, `MAX_FILE_BYTES` (not 4)
 *
 * And the type is checked by MAGIC BYTES in the service, not by the mimetype
 * the browser declares — a `.png` starting `MZ` is an executable whatever
 * header it arrives with. Uploads are held in memory until that check passes,
 * so a refused file never reaches the filesystem.
 *
 * **The `accept` attribute and the size check below are a courtesy, not the
 * boundary.** They save a player a round trip; they are not what makes this
 * safe, and they are trivially bypassed. The server is the authority and
 * stays it.
 *
 * ## The age rule is the server's, and it is worth saying out loud
 *
 * `dateOfBirth` is refused outside 18–120 years. That is not a form
 * preference — the platform cannot legally serve under-18s, and KYC is where
 * that gets established. Checked here too so the message arrives before the
 * upload does, rather than after several megabytes.
 *
 * ## Which document fields are shown depends on the type
 *
 * A passport is one page; an ID card and a driving licence have two sides,
 * and the back is where the address and the machine-readable strip live. So
 * the form asks for what the chosen document actually has rather than showing
 * three slots and letting the player guess which two to ignore.
 */

const DOCUMENT_TYPES = [
  { value: 'id_card', label: 'National ID card', fields: ['idFront', 'idBack'] },
  { value: 'passport', label: 'Passport', fields: ['passport'] },
  { value: 'driving_licence', label: "Driver's licence", fields: ['idFront', 'idBack'] },
];

const FIELD_LABELS = {
  idFront: 'Front of document',
  idBack: 'Back of document',
  passport: 'Passport photo page',
};

const GENDERS = [
  { value: '', label: 'Prefer not to say' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
];

export function KycDialog({ open, onClose }) {
  const submit = useSubmitKyc();

  const [fields, setFields] = useState(EMPTY);
  const [files, setFiles] = useState({});
  const [issues, setIssues] = useState({});
  const [done, setDone] = useState(false);

  const firstFieldRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setFields(EMPTY);
    setFiles({});
    setIssues({});
    setDone(false);
    submit.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const documentFields =
    DOCUMENT_TYPES.find((type) => type.value === fields.documentType)?.fields ?? [];

  /**
   * Setting a field clears its own error.
   *
   * Without this the messages only recompute on the next submit, so correcting
   * a date of birth leaves "You must be at least 18 years old" sitting under a
   * field that now reads 1990 — which is the form arguing with itself. Only
   * that field's message is dropped: the others are still true until they are
   * fixed too.
   */
  const set = (key) => (value) => {
    setFields((current) => ({ ...current, [key]: value }));
    setIssues((current) => (current[key] ? { ...current, [key]: undefined } : current));
  };

  function validate() {
    const found = {};
    if (!fields.firstName.trim()) found.firstName = 'Required.';
    if (!fields.lastName.trim()) found.lastName = 'Required.';
    if (!fields.address.trim()) found.address = 'Required.';
    if (!fields.city.trim()) found.city = 'Required.';
    if (!fields.country) found.country = 'Required.';

    if (!fields.dateOfBirth) {
      found.dateOfBirth = 'Required.';
    } else {
      const years = (Date.now() - new Date(fields.dateOfBirth).getTime()) / YEAR_MS;
      // The server's own bounds, checked early so the message beats the upload.
      if (years < 18) found.dateOfBirth = 'You must be at least 18 years old.';
      else if (years > 120) found.dateOfBirth = 'Check the year.';
    }

    // At least one document, and every slot the chosen type asks for.
    for (const field of documentFields) {
      if (!files[field]) found[field] = 'Attach this document.';
    }

    return found;
  }

  function attach(field, file) {
    if (!file) {
      setFiles((current) => ({ ...current, [field]: undefined }));
      return;
    }

    // Both of these are the server's rules, applied early. Neither is the
    // security boundary — see the block at the top.
    if (!KYC_ACCEPTED_TYPES.includes(file.type)) {
      setIssues((current) => ({ ...current, [field]: 'JPEG, PNG or PDF only.' }));
      return;
    }
    if (file.size > KYC_MAX_BYTES) {
      setIssues((current) => ({
        ...current,
        [field]: `That file is ${megabytes(file.size)} MB. The limit is 5 MB.`,
      }));
      return;
    }

    // Same rule as `set` above: attaching a document clears "Attach this
    // document" rather than leaving it under the file that is now there.
    setIssues((current) => ({ ...current, [field]: undefined }));
    setFiles((current) => ({ ...current, [field]: file }));
  }

  async function send(event) {
    event.preventDefault();

    const found = validate();
    setIssues(found);
    if (Object.values(found).some(Boolean)) return;

    try {
      await submit.mutateAsync({ ...fields, files });
      setDone(true);
    } catch {
      // `submit.error` carries it; the banner below renders from that. The
      // form is kept so a 422 on one field does not cost the other six.
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Verify your identity"
      initialFocus={firstFieldRef}
      width="max-w-[560px]"
    >
      {done ? (
        <div className="grid gap-4">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-roshi/15 text-roshi">
            <Icon name="check" size={28} />
          </span>
          <p className="text-center text-base leading-6 text-bulma">
            Your documents are with us.
          </p>
          <p className="text-center text-sm leading-5 text-trunks">
            The review is done by a person, so it is not instant. Your status is
            now <strong className="font-medium text-bulma">Pending</strong> and
            you will be emailed when it changes.
          </p>
          <Button size="lg" fullWidth onClick={onClose}>
            Done
          </Button>
        </div>
      ) : (
        <form onSubmit={send} className="grid gap-4">
          <p className="text-base leading-6 text-trunks">
            Enter your details exactly as they appear on the document you
            attach.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              ref={firstFieldRef}
              label="First name"
              value={fields.firstName}
              onChange={set('firstName')}
              autoComplete="given-name"
              error={issues.firstName}
            />
            <Field
              label="Last name"
              value={fields.lastName}
              onChange={set('lastName')}
              autoComplete="family-name"
              error={issues.lastName}
            />
            <Field
              label="Date of birth"
              type="date"
              value={fields.dateOfBirth}
              onChange={set('dateOfBirth')}
              autoComplete="bday"
              error={issues.dateOfBirth}
            />
            <SelectField
              label="Gender"
              value={fields.gender}
              onChange={set('gender')}
              options={GENDERS}
            />
          </div>

          <Field
            label="Address"
            value={fields.address}
            onChange={set('address')}
            autoComplete="street-address"
            error={issues.address}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="City"
              value={fields.city}
              onChange={set('city')}
              autoComplete="address-level2"
              error={issues.city}
            />
            <SelectField
              label="Country"
              value={fields.country}
              onChange={set('country')}
              error={issues.country}
              options={[
                { value: '', label: 'Select a country' },
                ...COUNTRIES.map((country) => ({ value: country.name, label: country.name })),
              ]}
            />
          </div>

          <SelectField
            label="Document type"
            value={fields.documentType}
            onChange={(value) => {
              set('documentType')(value);
              // The slots change with the type, so files attached for the
              // previous one would be sent under fields the server did not
              // ask for.
              setFiles({});
            }}
            options={DOCUMENT_TYPES.map((type) => ({ value: type.value, label: type.label }))}
          />

          <div className="grid gap-3">
            {documentFields.map((field) => (
              <FileField
                key={field}
                label={FIELD_LABELS[field]}
                file={files[field]}
                onChange={(file) => attach(field, file)}
                error={issues[field]}
              />
            ))}
          </div>

          {submit.isError && (
            <p role="alert" className="rounded-i-sm bg-dodoria/10 px-3 py-2 text-sm text-bulma">
              {submit.error?.message || 'The submission was refused.'}
            </p>
          )}

          <p className="text-xs leading-4 text-trunks">
            JPEG, PNG or PDF, up to 5 MB each. Your documents are stored for
            review and are not shown to anyone else.
          </p>

          <Button type="submit" size="lg" fullWidth disabled={submit.isPending}>
            {submit.isPending ? 'Submitting…' : 'Submit for review'}
          </Button>
        </form>
      )}
    </Dialog>
  );
}

const EMPTY = Object.freeze({
  firstName: '',
  lastName: '',
  dateOfBirth: '',
  gender: '',
  address: '',
  city: '',
  country: '',
  documentType: 'id_card',
});

const YEAR_MS = 365.25 * 24 * 3600 * 1000;

const megabytes = (bytes) => (bytes / 1024 / 1024).toFixed(1);

function Field({ ref, label, value, onChange, type = 'text', autoComplete, error }) {
  const id = useId();

  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm leading-5 text-trunks">
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        className={cn(
          'h-10 w-full rounded-i-sm border-[1.6px] bg-transparent px-2.5',
          'text-base leading-6 text-bulma outline-none transition-colors focus:border-piccolo',
          error ? 'border-chichi' : 'border-hit',
        )}
      />
      {error && <p className="text-xs leading-4 text-chichi">{error}</p>}
    </div>
  );
}

function SelectField({ label, value, onChange, options, error }) {
  const id = useId();

  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm leading-5 text-trunks">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        className={cn(
          'h-10 w-full cursor-pointer rounded-i-sm border-[1.6px] bg-transparent px-2',
          'text-base leading-6 text-bulma outline-none transition-colors focus:border-piccolo',
          error ? 'border-chichi' : 'border-hit',
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && <p className="text-xs leading-4 text-chichi">{error}</p>}
    </div>
  );
}

/**
 * A file input drawn as a button, because the native control cannot be styled
 * and prints "No file chosen" in a font nothing else on the page uses.
 *
 * The input is still a real `<input type="file">` inside the label — not a
 * `div` with a click handler — so it keeps keyboard focus, the space bar, and
 * whatever file picker the platform provides.
 */
function FileField({ label, file, onChange, error }) {
  const id = useId();

  return (
    <div className="grid gap-2">
      <span className="text-sm leading-5 text-trunks">{label}</span>
      <label
        htmlFor={id}
        className={cn(
          'flex cursor-pointer items-center gap-3 rounded-i-sm border-[1.6px] border-dashed px-3 py-3',
          'transition-colors hover:border-piccolo',
          error ? 'border-chichi' : file ? 'border-roshi' : 'border-hit',
        )}
      >
        <Icon
          name={file ? 'check' : 'plus'}
          size={18}
          className={file ? 'shrink-0 text-roshi' : 'shrink-0 text-trunks'}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-bulma">
            {file ? file.name : 'Choose a file'}
          </span>
          {file && (
            <span className="block text-xs text-trunks tabular-nums">
              {megabytes(file.size)} MB
            </span>
          )}
        </span>
        <input
          id={id}
          type="file"
          accept={KYC_ACCEPTED_TYPES.join(',')}
          onChange={(event) => onChange(event.target.files?.[0])}
          className="sr-only"
        />
      </label>
      {error && <p className="text-xs leading-4 text-chichi">{error}</p>}
    </div>
  );
}
