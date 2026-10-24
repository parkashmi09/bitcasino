'use client'

import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'

import { useRouter } from 'next/navigation'

import { toast } from 'sonner'

import { Loader2Icon } from 'lucide-react'

import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useSession } from '@/contexts/SessionContext'
import { api, errorMessage } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { ACCOUNTS_API, passwordError } from './api'
import { check } from '@/lib/validate'

/**
 * Create Account — zip `pages/users/InsertUser.jsx`.
 *
 * Login wale ke neeche naya staff ya player. Username live check hota hai (users + staff +
 * executives), Submit pe dobara taaza check. Credit Amount parent ke balance se jaata hai;
 * parent ke paas kam ho to account 0 credit pe banta hai aur message me parent ka balance.
 */

type Form = {
  username: string
  fullname: string
  email: string
  password: string
  cpassword: string
  city: string
  mono: string
  camt: string
  newlvlno: string
  point: string
  remark: string
  mpassword: string
  changePasswordLock: boolean
}

const EMPTY: Form = {
  username: '',
  fullname: '',
  email: '',
  password: '',
  cpassword: '',
  city: '',
  mono: '',
  camt: '',
  newlvlno: '0',
  point: '1',
  remark: '',
  mpassword: '',
  changePasswordLock: false
}

/** Hamare staff roles (roles table) — zip ke ROLES ki jagah. 'USER' = player. */
const STAFF_TYPES: { level: number; label: string }[] = [
  { level: 2, label: 'Admin' },
  { level: 3, label: 'Sub Admin' },
  { level: 4, label: 'Super Master' },
  { level: 5, label: 'Master' },
  { level: 6, label: 'Agent' }
]

const REQUIRED_FIELDS: (keyof Form)[] = ['username', 'fullname', 'email', 'password', 'cpassword', 'mpassword', 'city', 'mono', 'point', 'camt']

type CreateResult = { success: boolean; creditSkipped: boolean; message: string }

/** Zip (vee-validate) ke texts. */
const validateField = (name: keyof Form, value: string, all: Form) => {
  switch (name) {
    case 'username':
      if (!value.trim()) return 'The User Name field is required'
      if (!/^[a-zA-Z0-9]+$/.test(value)) return 'The User Name field may only contain alpha-numeric characters'
      if (value.length < 4) return 'The User Name field must be at least 4 characters'
      if (value.length > 60) return 'The User Name field may not be greater than 60 characters'

      return ''
    case 'fullname':
      if (!value.trim()) return 'The Full Name field is required'
      if (value.trim().length < 4) return 'The Full Name field must be at least 4 characters'
      if (value.trim().length > 120) return 'The Full Name field may not be greater than 120 characters'

      return ''
    case 'email':
      // Sirf staff (Admin … Agent) ke liye — User banate waqt field nahi dikhti.
      if (all.newlvlno === 'USER') return ''
      if (!value.trim()) return 'The Email field is required'
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) return 'The Email field must be a valid email'
      if (value.trim().length > 190) return 'The Email field may not be greater than 190 characters'

      return ''
    case 'password':
      return passwordError(value)
    case 'cpassword':
      if (!value) return 'The Confirm Password field is required'
      if (value !== all.password) return 'The Confirm Password confirmation does not match'

      return ''
    case 'city':
      return value && value.length < 3 ? 'The City field must be at least 3 characters' : ''
    case 'mono':
      if (value && !/^\d+$/.test(value)) return 'The Mobile Number field may only contain numeric characters'
      if (value && value.length < 10) return 'The Mobile Number field must be at least 10 characters'

      return ''
    case 'point':
      if (String(value).trim() === '') return 'The User Rate field is required'
      if (!/^\d*\.?\d+$/.test(String(value).trim()) || parseFloat(value) < 0.001) return 'The User Rate field must be 0.001 or more'

      return ''
    case 'camt':
      // Optional (empty = 0); server takes a string of at most 20 characters.
      return check.number(value, 'The Credit Amount', { min: 0, decimals: 2, optional: true }) || (value.length > 20 ? 'The Credit Amount is too long' : '') || ''
    case 'mpassword':
      return value ? '' : 'required' // zip me sirf laal border, message nahi

    default:
      return ''
  }
}

const CreateAccount = () => {
  const router = useRouter()
  const { actor } = useSession()
  const [form, setForm] = useState<Form>(EMPTY)
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({})
  const [loading, setLoading] = useState(false)

  // idle | checking | available | taken
  const [nameCheck, setNameCheck] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle')

  // Owner sab level bana sakta hai; baaki sirf apne theek neeche wala (staff module ka rule). Player sab.
  const myLevel = Number(actor?.level ?? 99)
  const staffTypes = STAFF_TYPES.filter(r => (myLevel === 1 ? r.level > 1 : r.level === myLevel + 1))
  const isUser = form.newlvlno === 'USER'

  // Live username check — 3+ akshar, 350ms debounce, purana request abort.
  useEffect(() => {
    const name = form.username

    if (name.length < 3 || !/^[a-zA-Z0-9]+$/.test(name)) return

    const controller = new AbortController()

    const timer = setTimeout(async () => {
      setNameCheck('checking')

      try {
        const res = await api.get<{ available: boolean }>(`${ACCOUNTS_API}/check-username`, { username: name }, controller.signal)

        setNameCheck(res.available ? 'available' : 'taken')
      } catch {
        if (!controller.signal.aborted) setNameCheck('idle')
      }
    }, 350)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [form.username])

  const setField = (name: keyof Form, value: string | boolean) => {
    const next = { ...form, [name]: value } as Form

    // Lock toggle sirf User ke liye — type badla to band.
    if (name === 'newlvlno' && value !== 'USER') next.changePasswordLock = false
    if (name === 'username') setNameCheck('idle')
    setForm(next)

    if (!REQUIRED_FIELDS.includes(name)) return
    setErrors(prev => {
      const updated = { ...prev, [name]: validateField(name, String(value), next) }

      if (name === 'password' && next.cpassword) updated.cpassword = validateField('cpassword', next.cpassword, next)

      return updated
    })
  }

  const onInput = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setField(e.target.name as keyof Form, e.target.value)

  const onBlur = (e: ChangeEvent<HTMLInputElement>) => {
    const name = e.target.name as keyof Form

    if (REQUIRED_FIELDS.includes(name)) setErrors(prev => ({ ...prev, [name]: validateField(name, e.target.value, form) }))
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (loading) return

    // Duplicate naam sabse pehle, taaza server jawab se (zip jaisa).
    if (/^[a-zA-Z0-9]+$/.test(form.username) && form.username.length >= 3) {
      setLoading(true)

      try {
        const res = await api.get<{ available: boolean; message: string }>(`${ACCOUNTS_API}/check-username`, { username: form.username })

        if (!res.available) {
          setNameCheck('taken')
          toast.error(res.message || 'User Name Already Exists')
          setLoading(false)

          return
        }
      } catch {
        /* the check is advisory — the create route refuses a duplicate itself (and that error is toasted) */
      }

      setLoading(false)
    }

    const nextErrors: Partial<Record<keyof Form, string>> = {}

    for (const f of REQUIRED_FIELDS) {
      const msg = validateField(f, String(form[f]), form)

      if (msg) nextErrors[f] = msg
    }

    setErrors(nextErrors)

    if (Object.keys(nextErrors).length) {
      const first = Object.entries(nextErrors)[0]

      toast.error(first[0] === 'mpassword' ? 'The Transaction Code field is required' : first[1])

      return
    }

    setLoading(true)

    try {
      // User Type: 'USER' ya staff ka level — server us level ka role chunta hai.
      const res = await api.post<CreateResult>(`${ACCOUNTS_API}/create`, {
        username: form.username,
        fullname: form.fullname,
        email: isUser ? undefined : form.email.trim().toLowerCase(),
        password: form.password,
        city: form.city || undefined,
        phone: form.mono || undefined,
        creditAmount: form.camt,
        userType: form.newlvlno === 'USER' ? 'USER' : Number(form.newlvlno),
        percentage: form.point,
        remark: form.remark || undefined,
        transactionPassword: form.mpassword
      })

      if (res.creditSkipped) toast.success(res.message, { duration: 6000 })
      else toast.success(`Account ${form.username} created`)
      router.push('/exchange/users')
    } catch (err) {
      const msg = errorMessage(err)

      if (/user ?name already exists/i.test(msg)) setNameCheck('taken')
      if (/email is already in use/i.test(msg)) setErrors(prev => ({ ...prev, email: 'This email is already in use' }))
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  const invalid = (name: keyof Form) => Boolean(errors[name])

  const field = (name: keyof Form, label: string, opts: { required?: boolean; type?: string; maxLength?: number } = {}) => (
    <div className='space-y-1.5'>
      <Label htmlFor={name}>
        {label}: {opts.required && <span className='text-destructive'>*</span>}
      </Label>
      <Input
        id={name}
        name={name}
        type={opts.type ?? 'text'}
        placeholder={label}
        maxLength={opts.maxLength}
        autoComplete={name === 'username' ? 'new-password' : undefined}
        aria-invalid={invalid(name) || (name === 'username' && nameCheck === 'taken')}
        className={cn(name === 'username' && nameCheck === 'available' && !errors.username && 'border-success')}
        value={String(form[name])}
        onChange={onInput}
        onBlur={onBlur}
      />
      {name === 'username' && nameCheck === 'taken' ? (
        <small className='text-destructive text-xs'>User Name is not available</small>
      ) : errors[name] && name !== 'mpassword' ? (
        <small className='text-destructive text-xs'>{errors[name]}</small>
      ) : null}
    </div>
  )

  return (
    <div>
      <PageHeader title='Create Account' />

      <form onSubmit={handleSubmit} className='grid gap-6 md:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle>General Information</CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            {field('username', 'User name', { required: true })}
            {field('fullname', 'Full Name', { required: true })}
            {!isUser && field('email', 'Email', { required: true, type: 'email' })}
            {field('password', 'Password', { required: true, type: 'password' })}
            {field('cpassword', 'Confirm Password', { required: true, type: 'password' })}
            {field('city', 'City')}
            {field('mono', 'Mobile Number', { maxLength: 15 })}
          </CardContent>
        </Card>

        <Card>
          <CardContent className='space-y-4 pt-6'>
            <div className='space-y-1.5'>
              <Label htmlFor='camt'>Credit Amount:</Label>
              <Input id='camt' name='camt' type='number' min={0} placeholder='Credit Amount' aria-invalid={invalid('camt')} value={form.camt} onChange={onInput} />
              {errors.camt && <small className='text-destructive text-xs'>{errors.camt}</small>}
            </div>

            <div className='space-y-1.5'>
              <Label>
                User Type: <span className='text-destructive'>*</span>
              </Label>
              <Select value={form.newlvlno} onValueChange={v => setField('newlvlno', String(v))}>
                <SelectTrigger className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='0'>Select User Type</SelectItem>
                  {staffTypes.map(r => (
                    <SelectItem key={r.level} value={String(r.level)}>
                      {r.label}
                    </SelectItem>
                  ))}
                  <SelectItem value='USER'>User</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <h4 className='text-base font-semibold'>Partnership Information</h4>

            {field('point', 'User Rate')}

            <div className='space-y-1.5'>
              <Label htmlFor='remark'>Remark:</Label>
              <Textarea id='remark' name='remark' placeholder='Remark' value={form.remark} onChange={onInput} />
            </div>

            {/* ON = naya account apna password khud nahi badal sakta. Sirf User ke liye. */}
            {isUser && (
              <div className='flex items-center gap-2'>
                <Switch id='changePasswordLock' checked={form.changePasswordLock} onCheckedChange={v => setField('changePasswordLock', Boolean(v))} />
                <Label htmlFor='changePasswordLock' className='font-bold'>
                  Change Password Lock
                </Label>
              </div>
            )}

            <div className='flex items-center justify-end gap-2'>
              <Input
                name='mpassword'
                type='password'
                placeholder='Transaction Code'
                aria-invalid={invalid('mpassword')}
                value={form.mpassword}
                onChange={onInput}
                onBlur={onBlur}
              />
              <Button type='submit' disabled={loading}>
                {loading && <Loader2Icon className='animate-spin' />}
                Submit
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  )
}

export default CreateAccount
