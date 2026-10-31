'use client'

import { useState } from 'react'

import { PlusIcon, Trash2Icon } from 'lucide-react'

import ErrorState from '@/components/shared/ErrorState'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useSession } from '@/contexts/SessionContext'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'

/** `GET /api/v1/admin/site-content` — every saved section (backend modules/site-content). */
type SiteContent = { keys: string[]; networks: string[]; content: Record<string, Value> }

type Value = Record<string, unknown>

type Field =
  | { key: string; label: string; kind?: 'text' | 'textarea' | 'network'; max: number; hint?: string }
  | { key: string; label: string; kind: 'list'; max: number; item: string; fields: Field[] }

/** One card per section; the limits match the backend's validators (siteContent.validators.js). */
const SECTIONS: { key: string; title: string; description: string; fields: Field[] }[] = [
  {
    key: 'home',
    title: 'Home page',
    description: 'The hero text and the register button on the home page.',
    fields: [
      { key: 'heroTitle', label: 'Hero title', max: 120 },
      { key: 'heroSubtitle', label: 'Hero subtitle', max: 300 },
      { key: 'registerCta', label: 'Register button text', max: 40 }
    ]
  },
  {
    key: 'support',
    title: 'Support',
    description: 'Where players get help.',
    fields: [
      { key: 'email', label: 'Support email', max: 200 },
      { key: 'liveChatUrl', label: 'Live chat link', max: 500 },
      { key: 'helpCenterUrl', label: 'Help centre link', max: 500 }
    ]
  },
  {
    key: 'social',
    title: 'Social links',
    description: 'The icons in the footer.',
    fields: [
      {
        key: 'links',
        label: 'Links',
        kind: 'list',
        max: 20,
        item: 'link',
        fields: [
          { key: 'network', label: 'Network', kind: 'network', max: 20 },
          { key: 'href', label: 'Link', max: 500 }
        ]
      }
    ]
  },
  {
    key: 'footer',
    title: 'Footer',
    description: 'The footer columns and their links.',
    fields: [
      {
        key: 'columns',
        label: 'Columns',
        kind: 'list',
        max: 8,
        item: 'column',
        fields: [
          { key: 'title', label: 'Column title', max: 60 },
          {
            key: 'links',
            label: 'Links',
            kind: 'list',
            max: 20,
            item: 'link',
            fields: [
              { key: 'label', label: 'Label', max: 80 },
              { key: 'href', label: 'Link', max: 500 }
            ]
          }
        ]
      }
    ]
  },
  {
    key: 'legal',
    title: 'Legal',
    description: 'The company note, licence and age notice under the footer.',
    fields: [
      { key: 'companyNote', label: 'Company note', kind: 'textarea', max: 1000 },
      { key: 'copyright', label: 'Copyright line', max: 200 },
      { key: 'licenseText', label: 'Licence text', kind: 'textarea', max: 1000 },
      { key: 'licenseUrl', label: 'Licence link', max: 500 },
      { key: 'ageNotice', label: 'Age notice', kind: 'textarea', max: 300 }
    ]
  },
  {
    key: 'pages',
    title: 'Pages',
    description: 'Terms, privacy, cookies, responsible gambling… Plain text or simple markdown.',
    fields: [
      {
        key: 'items',
        label: 'Pages',
        kind: 'list',
        max: 30,
        item: 'page',
        fields: [
          { key: 'slug', label: 'Slug', max: 64, hint: 'lowercase-with-dashes, e.g. terms' },
          { key: 'title', label: 'Title', max: 120 },
          { key: 'body', label: 'Body', kind: 'textarea', max: 50_000 }
        ]
      }
    ]
  },
  {
    key: 'vip',
    title: 'VIP page',
    description: 'The VIP club page text, benefits and questions.',
    fields: [
      { key: 'title', label: 'Title', max: 120 },
      { key: 'subtitle', label: 'Subtitle', max: 300 },
      {
        key: 'benefits',
        label: 'Benefits',
        kind: 'list',
        max: 20,
        item: 'benefit',
        fields: [
          { key: 'title', label: 'Title', max: 80 },
          { key: 'text', label: 'Text', kind: 'textarea', max: 500 }
        ]
      },
      {
        key: 'faq',
        label: 'FAQ',
        kind: 'list',
        max: 30,
        item: 'question',
        fields: [
          { key: 'q', label: 'Question', max: 200 },
          { key: 'a', label: 'Answer', kind: 'textarea', max: 2000 }
        ]
      }
    ]
  }
]

/** An empty item for a list: '' per text field, [] per nested list, the first network. */
const blank = (fields: Field[], networks: string[]): Value =>
  Object.fromEntries(fields.map(f => [f.key, f.kind === 'list' ? [] : f.kind === 'network' ? networks[0] ?? 'other' : '']))

const Fields = ({ fields, value, onChange, networks, disabled, id }: { fields: Field[]; value: Value; onChange: (v: Value) => void; networks: string[]; disabled: boolean; id: string }) => (
  <div className='grid gap-3'>
    {fields.map(f => {
      const fid = `${id}-${f.key}`
      const set = (v: unknown) => onChange({ ...value, [f.key]: v })

      if (f.kind === 'list') {
        const items = (Array.isArray(value[f.key]) ? value[f.key] : []) as Value[]

        return (
          <div key={f.key} className='grid gap-2'>
            <Label>{f.label}</Label>
            {items.map((item, i) => (
              <div key={i} className='flex gap-2 rounded-md border p-3'>
                <div className='flex-1'>
                  <Fields fields={f.fields} value={item} networks={networks} disabled={disabled} id={`${fid}-${i}`} onChange={v => set(items.map((it, j) => (j === i ? v : it)))} />
                </div>
                {!disabled && (
                  <Button type='button' size='icon' variant='ghost' aria-label={`Remove ${f.item}`} onClick={() => set(items.filter((_, j) => j !== i))}>
                    <Trash2Icon />
                  </Button>
                )}
              </div>
            ))}
            {!disabled && items.length < f.max && (
              <Button type='button' size='sm' variant='outline' className='w-fit' onClick={() => set([...items, blank(f.fields, networks)])}>
                <PlusIcon /> Add {f.item}
              </Button>
            )}
          </div>
        )
      }

      const text = typeof value[f.key] === 'string' ? (value[f.key] as string) : ''

      return (
        <div key={f.key} className='grid gap-1.5'>
          <Label htmlFor={fid}>{f.label}</Label>
          {f.kind === 'network' ? (
            <Select value={text || networks[0]} onValueChange={v => v && set(String(v))} disabled={disabled}>
              <SelectTrigger id={fid} className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {networks.map(n => (
                  <SelectItem key={n} value={n}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : f.kind === 'textarea' ? (
            <Textarea id={fid} rows={f.max > 5000 ? 10 : 3} maxLength={f.max} value={text} disabled={disabled} onChange={e => set(e.target.value)} />
          ) : (
            <Input id={fid} maxLength={f.max} value={text} disabled={disabled} onChange={e => set(e.target.value)} />
          )}
          {f.hint && <p className='text-muted-foreground text-xs'>{f.hint}</p>}
        </div>
      )
    })}
  </div>
)

const SectionCard = ({ section, saved, networks, canEdit }: { section: (typeof SECTIONS)[number]; saved?: Value; networks: string[]; canEdit: boolean }) => {
  const [form, setForm] = useState<Value>(() => ({ ...blank(section.fields, networks), ...saved }))

  const save = useApiMutation({
    fn: () => api.put(`admin/site-content/${section.key}`, form),
    invalidate: [['api', 'admin/site-content']],
    success: `${section.title} saved`
  })

  return (
    <Card className='shadow-none'>
      <CardHeader>
        <CardTitle className='text-base'>{section.title}</CardTitle>
        <CardDescription>{section.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className='grid gap-4'
          onSubmit={e => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <Fields fields={section.fields} value={form} onChange={setForm} networks={networks} disabled={!canEdit} id={`content-${section.key}`} />
          {canEdit && (
            <Button type='submit' size='sm' className='w-fit' disabled={save.isPending}>
              Save
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  )
}

/** Site config → Content: the player site's copy and links. Links are http(s) or start with /. */
const Content = () => {
  const q = useApi<SiteContent>('admin/site-content')
  const { can, actor } = useSession()
  const canEdit = actor?.direct === true && can('config:write')

  return (
    <div>
      <PageHeader title='Content' description="The player site's footer, links, support details, legal text, pages and VIP copy. Empty fields use the site's own." />
      {q.error && <ErrorState error={q.error} />}
      {q.isLoading || !q.data ? (
        <Skeleton className='h-64 w-full max-w-3xl' />
      ) : (
        <div className='grid max-w-5xl gap-4 lg:grid-cols-2'>
          {SECTIONS.map(s => (
            <SectionCard key={s.key} section={s} saved={q.data.content[s.key]} networks={q.data.networks} canEdit={canEdit} />
          ))}
        </div>
      )}
    </div>
  )
}

export default Content
