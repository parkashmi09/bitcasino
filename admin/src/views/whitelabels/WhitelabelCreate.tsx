'use client'

import { useState, type ReactNode } from 'react'

import { useRouter } from 'next/navigation'

import { Loader2Icon } from 'lucide-react'

import { TextAreaField, TextField } from '@/components/shared/FormField'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'

import ImageField, { POSTER, type PickedImage } from './ImageField'
import PaletteEditor, { paletteError, type ThemeValue } from './PaletteEditor'
import PlanPicker, { EMPTY_PLAN, planError } from './PlanPicker'
import type { Plan, Whitelabel } from './types'

const DOMAIN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
const SLUG = /^[a-z][a-z0-9-]{2,28}[a-z0-9]$/

/** "Lucky Play 7" → "lucky-play-7": the copy's folder, pm2 prefix and database name. */
const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/-+$/, '')
    .slice(0, 30)

const Section = ({ title, description, children }: { title: string; description?: string; children: ReactNode }) => (
  <Card>
    <CardHeader>
      <CardTitle>{title}</CardTitle>
      {description && <CardDescription>{description}</CardDescription>}
    </CardHeader>
    <CardContent className='grid gap-4'>{children}</CardContent>
  </Card>
)

/**
 * New whitelabel: brand, domains, plan (products and features), colours and the company's login. Saving queues it for the setup
 * script, which builds the copy on this server (its own folder, database and processes); the
 * detail page shows the setup's progress.
 */
const WhitelabelCreate = () => {
  const router = useRouter()

  const [form, setForm] = useState({
    name: '',
    slug: '',
    title: '',
    description: '',
    siteDomain: '',
    adminDomain: '',
    apiDomain: '',
    companyRoleName: 'Company',
    companyName: '',
    companyEmail: '',
    companyPassword: '',
    confirm: ''
  })

  const [slugTouched, setSlugTouched] = useState(false)
  const [theme, setTheme] = useState<ThemeValue>({ template: 'hash_game', palette: null })
  const [logo, setLogo] = useState<PickedImage | null>(null)
  const [icon, setIcon] = useState<PickedImage | null>(null)
  const [poster, setPoster] = useState<PickedImage | null>(null)
  const [posterMobile, setPosterMobile] = useState<PickedImage | null>(null)
  const [plan, setPlan] = useState<Plan>(EMPTY_PLAN)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const set = (patch: Partial<typeof form>) => {
    setForm(f => ({ ...f, ...patch }))
    setErrors(e => {
      const next = { ...e }

      for (const k of Object.keys(patch)) delete next[k]

      return next
    })
  }

  const validate = () => {
    const e: Record<string, string> = {}
    const domains = [form.siteDomain, form.adminDomain, form.apiDomain].map(d => d.trim().toLowerCase())

    if (form.name.trim().length < 2) e.name = 'At least 2 characters'
    if (!SLUG.test(form.slug)) e.slug = '4–30 lower-case letters, digits and -, starting with a letter'
    for (const [k, d] of [['siteDomain', domains[0]], ['adminDomain', domains[1]], ['apiDomain', domains[2]]]) if (!DOMAIN.test(d)) e[k] = 'A domain like play.example.com'
    if (!e.adminDomain && domains[1] === domains[0]) e.adminDomain = 'Must differ from the site domain'
    if (!e.apiDomain && (domains[2] === domains[0] || domains[2] === domains[1])) e.apiDomain = 'Must differ from the other two'
    if (form.companyRoleName.trim().length < 2) e.companyRoleName = 'At least 2 characters'
    if (form.companyName.trim().length < 2) e.companyName = 'At least 2 characters'
    if (!/^\S+@\S+\.\S+$/.test(form.companyEmail.trim())) e.companyEmail = 'A valid email'
    if (form.companyPassword.length < 8 || form.companyPassword.length > 72) e.companyPassword = '8–72 characters'
    if (form.confirm !== form.companyPassword) e.confirm = 'Passwords do not match'
    const colours = paletteError(theme.palette)

    if (colours) e.palette = colours
    const products = planError(plan)

    if (products) e.plan = products
    setErrors(e)

    return Object.keys(e).length === 0
  }

  const create = useApiMutation({
    fn: () =>
      api.post<Whitelabel>('admin/whitelabels', {
        name: form.name.trim(),
        slug: form.slug,
        ...(form.title.trim() ? { title: form.title.trim() } : {}),
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
        siteDomain: form.siteDomain.trim().toLowerCase(),
        adminDomain: form.adminDomain.trim().toLowerCase(),
        apiDomain: form.apiDomain.trim().toLowerCase(),
        template: theme.template,
        palette: theme.palette,
        plan,
        ...(logo ? { logo: { type: logo.type, data: logo.data } } : {}),
        ...(icon ? { icon: { type: icon.type, data: icon.data } } : {}),
        ...(poster ? { poster: { type: poster.type, data: poster.data } } : {}),
        ...(posterMobile ? { posterMobile: { type: posterMobile.type, data: posterMobile.data } } : {}),
        companyRoleName: form.companyRoleName.trim(),
        companyName: form.companyName.trim(),
        companyEmail: form.companyEmail.trim().toLowerCase(),
        companyPassword: form.companyPassword
      }),
    invalidate: [['paged', 'admin/whitelabels']],
    success: 'Whitelabel saved — setup is queued',
    onSuccess: result => router.push(`/whitelabels/${result.id}`)
  })

  const field = (key: keyof typeof form, label: string, extra: Partial<React.ComponentProps<typeof TextField>> = {}) => (
    <TextField id={`wl-${key}`} label={label} value={form[key]} error={errors[key]} onChange={e => set({ [key]: e.target.value } as Partial<typeof form>)} {...extra} />
  )

  return (
    <form
      className='grid gap-6'
      onSubmit={e => {
        e.preventDefault()
        if (validate()) create.mutate()
      }}
    >
      <PageHeader
        title='New whitelabel'
        description='A full copy of this site — player site, admin and backend — on its own domains, run by its company.'
        actions={
          <Button type='submit' disabled={create.isPending}>
            {create.isPending && <Loader2Icon className='animate-spin' />} Create whitelabel
          </Button>
        }
      />

      <Section title='Brand' description='What players see.'>
        <div className='grid gap-4 sm:grid-cols-2'>
          {field('name', 'Name', {
            required: true,
            maxLength: 60,
            onChange: e => set({ name: e.target.value, ...(slugTouched ? {} : { slug: slugOf(e.target.value) }) })
          })}
          {field('slug', 'Short name (folder & database)', {
            required: true,
            maxLength: 30,
            hint: 'Lower-case, fixed for good: /var/www/main/<short name>.',
            onChange: e => {
              setSlugTouched(true)
              set({ slug: e.target.value.toLowerCase() })
            }
          })}
        </div>
        {field('title', 'Page title (optional)', { maxLength: 70 })}
        <TextAreaField id='wl-description' label='Description (optional)' maxLength={300} value={form.description} onChange={e => set({ description: e.target.value })} />
        <div className='grid gap-4 sm:grid-cols-2'>
          <ImageField
            label='Logo (optional)'
            hint='PNG, WebP or SVG, at most 256 KB.'
            value={logo}
            onChange={setLogo}
            onError={message => setErrors(e => ({ ...e, logo: message }))}
          />
          <ImageField
            label='Icon (optional)'
            hint='Square. Favicon and small icons; without one the logo is used.'
            value={icon}
            onChange={setIcon}
            onError={message => setErrors(e => ({ ...e, icon: message }))}
            square
          />
        </div>
        <div className='grid gap-4 sm:grid-cols-2'>
          <ImageField
            label='Home poster, desktop (optional)'
            hint='About 1276×270. Without one: the logo on the brand colours.'
            value={poster}
            onChange={setPoster}
            onError={message => setErrors(e => ({ ...e, poster: message }))}
            {...POSTER}
          />
          <ImageField
            label='Home poster, phone (optional)'
            hint='About 372×215. Without one: the desktop poster.'
            value={posterMobile}
            onChange={setPosterMobile}
            onError={message => setErrors(e => ({ ...e, poster: message }))}
            {...POSTER}
          />
        </div>
        {(errors.logo || errors.icon || errors.poster) && <span className='text-destructive text-sm'>{errors.logo || errors.icon || errors.poster}</span>}
      </Section>

      <Section title='Domains' description='Point all three at this server (A record) before setup runs: it fetches the SSL certificates.'>
        <div className='grid gap-4 sm:grid-cols-3'>
          {field('siteDomain', 'Player site', {
            required: true,
            placeholder: 'play.example.com',
            onChange: e => {
              const site = e.target.value.trim().toLowerCase()
              const was = form.siteDomain.trim().toLowerCase()

              set({
                siteDomain: e.target.value,

                // Follow the site domain until edited by hand.
                ...(!form.adminDomain || form.adminDomain === `admin.${was}` ? { adminDomain: site ? `admin.${site}` : '' } : {}),
                ...(!form.apiDomain || form.apiDomain === `api.${was}` ? { apiDomain: site ? `api.${site}` : '' } : {})
              })
            }
          })}
          {field('adminDomain', 'Admin panel', { required: true, placeholder: 'admin.example.com' })}
          {field('apiDomain', 'API', { required: true, placeholder: 'api.example.com' })}
        </div>
      </Section>

      <Section title='Products & features' description='What the whitelabel runs. Choose at least one product; anything left out stays off and hidden on its site. You can change it later.'>
        <PlanPicker
          value={plan}
          onChange={next => {
            setPlan(next)
            setErrors(e => ({ ...e, plan: '' }))
          }}
        />
        {errors.plan && <span className='text-destructive text-sm'>{errors.plan}</span>}
      </Section>

      <Section title='Colours'>
        <PaletteEditor value={theme} onChange={setTheme} name={form.name} logoUrl={logo?.url} />
        {errors.palette && <span className='text-destructive text-sm'>{errors.palette}</span>}
      </Section>

      <Section
        title='Company login'
        description='The top account of the whitelabel. It signs in on the admin domain, must set a new password and its own transaction code on first sign-in, and gets its balance only from your transfers.'
      >
        <div className='grid gap-4 sm:grid-cols-3'>
          {field('companyRoleName', 'Hierarchy name', { required: true, maxLength: 40, hint: 'Shown instead of “Super Admin”.' })}
          {field('companyName', 'Company name', { required: true, maxLength: 80 })}
          {field('companyEmail', 'Login email', { required: true, type: 'email', maxLength: 190 })}
        </div>
        <div className='grid gap-4 sm:grid-cols-2'>
          {field('companyPassword', 'Password', { required: true, type: 'password', autoComplete: 'new-password', maxLength: 72 })}
          {field('confirm', 'Confirm password', { required: true, type: 'password', autoComplete: 'new-password', maxLength: 72 })}
        </div>
      </Section>
    </form>
  )
}

export default WhitelabelCreate
