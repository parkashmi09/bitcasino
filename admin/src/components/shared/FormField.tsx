'use client'

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

import { toast } from 'sonner'

import {
  DatePicker,
  DateRangePicker,
  DateTimePicker,
  type DatePickerProps,
  type DateRangePickerProps,
  type DateTimePickerProps
} from '@/components/ui/date-picker'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cleanErrors, serverFieldErrors, type FieldErrors } from '@/lib/validate'

type Base = {
  id: string
  label: ReactNode
  hint?: ReactNode
  required?: boolean

  /** An inline message under the field. Inside a `FormDialog` the dialog's `validate` / server 422 fills it by `name` or `id`. */
  error?: string | false | null
}

type ErrorsCtx = { errors: Record<string, string>; clear: (key: string) => void }

const FormErrorsContext = createContext<ErrorsCtx | null>(null)

/** Gives every field below it its message from `errors[name ?? id]` (FormDialog wraps its body in this). */
export const FormErrorsProvider = ({ errors, onClear, children }: { errors: Record<string, string>; onClear: (key: string) => void; children: ReactNode }) => (
  <FormErrorsContext.Provider value={{ errors, clear: onClear }}>{children}</FormErrorsContext.Provider>
)

/**
 * Inline errors for a form that is not a `FormDialog` (settings pages). Wrap the fields in
 * `<FormErrorsProvider errors={f.errors} onClear={f.clear}>`; `f.passes({...})` shows the messages,
 * toasts the first and says whether to send; `f.fromServer(error)` maps a 422 onto the fields.
 */
export const useFormErrors = () => {
  const [errors, setErrors] = useState<Record<string, string>>({})

  const passes = useCallback((map: FieldErrors | string | null | undefined | false) => {
    if (typeof map === 'string' && map) {
      toast.error(map)

      return false
    }

    const found = typeof map === 'object' ? cleanErrors(map) : {}

    setErrors(found)
    const first = Object.values(found)[0]

    if (first) toast.error(first)

    return !first
  }, [])

  const clear = useCallback(
    (key: string) =>
      setErrors(prev => {
        const next = { ...prev }

        delete next[key]

        return next
      }),
    []
  )

  const fromServer = useCallback((error: unknown) => setErrors(serverFieldErrors(error)), [])
  const reset = useCallback(() => setErrors({}), [])

  return { errors, passes, clear, fromServer, reset }
}

/** The message for a field and a way to clear it once the user edits that field. */
export const useFieldError = (id: string, name?: string, explicit?: string | false | null) => {
  const ctx = useContext(FormErrorsContext)
  const fromCtx = ctx ? (name ? ctx.errors[name] : undefined) ?? ctx.errors[id] : undefined
  const message = explicit || fromCtx || undefined

  const clear = () => {
    if (!ctx) return
    if (name && ctx.errors[name]) ctx.clear(name)
    if (ctx.errors[id]) ctx.clear(id)
  }

  return { message, clear }
}

export const Message = ({ id, message }: { id: string; message?: string }) => (message ? <FieldError id={`${id}-error`}>{message}</FieldError> : null)

export const TextField = ({ id, label, hint, required, error, onChange, ...input }: Base & Omit<React.ComponentProps<typeof Input>, 'id'>) => {
  const { message, clear } = useFieldError(id, typeof input.name === 'string' ? input.name : undefined, error)

  return (
    <Field className='gap-2' data-invalid={message ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}{required && ' *'}</FieldLabel>
      <Input
        id={id}
        required={required}
        aria-invalid={message ? true : undefined}
        aria-describedby={message ? `${id}-error` : undefined}
        onChange={e => {
          clear()
          onChange?.(e)
        }}
        {...input}
      />
      <Message id={id} message={message} />
      {hint && <FieldDescription>{hint}</FieldDescription>}
    </Field>
  )
}

/** `value`/`onChange` use 'yyyy-MM-dd' strings, like the old `type='date'` input. */
export const DateField = ({ id, label, hint, required, error, onChange, ...picker }: Base & Omit<DatePickerProps, 'id'>) => {
  const { message, clear } = useFieldError(id, undefined, error)

  return (
    <Field className='gap-2' data-invalid={message ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}{required && ' *'}</FieldLabel>
      <DatePicker
        id={id}
        required={required}
        onChange={v => {
          clear()
          onChange(v)
        }}
        {...picker}
      />
      <Message id={id} message={message} />
      {hint && <FieldDescription>{hint}</FieldDescription>}
    </Field>
  )
}

/** `value`/`onChange` use 'yyyy-MM-ddTHH:mm' local strings, like the old `type='datetime-local'` input. */
export const DateTimeField = ({ id, label, hint, required, error, onChange, ...picker }: Base & Omit<DateTimePickerProps, 'id'>) => {
  const { message, clear } = useFieldError(id, undefined, error)

  return (
    <Field className='gap-2' data-invalid={message ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}{required && ' *'}</FieldLabel>
      <DateTimePicker
        id={id}
        required={required}
        onChange={v => {
          clear()
          onChange(v)
        }}
        {...picker}
      />
      <Message id={id} message={message} />
      {hint && <FieldDescription>{hint}</FieldDescription>}
    </Field>
  )
}

export const DateRangeField = ({ id, label, hint, required, error, onChange, ...picker }: Base & Omit<DateRangePickerProps, 'id'>) => {
  const { message, clear } = useFieldError(id, undefined, error)

  return (
    <Field className='gap-2' data-invalid={message ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}{required && ' *'}</FieldLabel>
      <DateRangePicker
        id={id}
        required={required}
        className='sm:w-full'
        onChange={v => {
          clear()
          onChange(v)
        }}
        {...picker}
      />
      <Message id={id} message={message} />
      {hint && <FieldDescription>{hint}</FieldDescription>}
    </Field>
  )
}

export const TextAreaField = ({ id, label, hint, required, error, onChange, ...input }: Base & Omit<React.ComponentProps<typeof Textarea>, 'id'>) => {
  const { message, clear } = useFieldError(id, typeof input.name === 'string' ? input.name : undefined, error)

  return (
    <Field className='gap-2' data-invalid={message ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}{required && ' *'}</FieldLabel>
      <Textarea
        id={id}
        required={required}
        aria-invalid={message ? true : undefined}
        aria-describedby={message ? `${id}-error` : undefined}
        onChange={e => {
          clear()
          onChange?.(e)
        }}
        {...input}
      />
      <Message id={id} message={message} />
      {hint && <FieldDescription>{hint}</FieldDescription>}
    </Field>
  )
}

export const SelectField = ({
  id,
  label,
  hint,
  required,
  error,
  name,
  value,
  onChange,
  options,
  placeholder,
  disabled
}: Base & {
  name?: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: ReactNode }[]
  placeholder?: string
  disabled?: boolean
}) => {
  const { message, clear } = useFieldError(id, name, error)

  return (
    <Field className='gap-2' data-invalid={message ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}{required && ' *'}</FieldLabel>
      <Select
        value={value}
        disabled={disabled}
        onValueChange={v => {
          if (v === null) return
          clear()
          onChange(v)
        }}
      >
        <SelectTrigger id={id} className='w-full' aria-invalid={message ? true : undefined}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map(o => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Message id={id} message={message} />
      {hint && <FieldDescription>{hint}</FieldDescription>}
    </Field>
  )
}

export const SwitchField = ({
  id,
  label,
  hint,
  checked,
  onChange,
  disabled
}: Base & { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) => (
  <Field orientation='horizontal' className='border-border items-center justify-between gap-4 rounded-lg border px-3 py-2'>
    <div className='min-w-0'>
      <FieldLabel htmlFor={id} className='cursor-pointer'>{label}</FieldLabel>
      {hint && <FieldDescription className='text-xs'>{hint}</FieldDescription>}
    </div>
    <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
  </Field>
)
