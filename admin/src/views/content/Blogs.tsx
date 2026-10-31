'use client'

import { useState } from 'react'

import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'

import Can from '@/components/shared/Can'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import FormDialog from '@/components/shared/FormDialog'
import { SwitchField, TextAreaField, TextField } from '@/components/shared/FormField'
import PageHeader from '@/components/shared/PageHeader'
import StatusBadge from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useApi, useApiMutation, useListState, usePagedApi } from '@/hooks/use-api'
import { api, errorMessage } from '@/lib/api/client'
import { check } from '@/lib/validate'
import type { Blog } from './types'

/**
 * Blog posts. The list route pages by `page`/`limit` (not offset — this module
 * is the one exception), and the article body only comes back on the single-post
 * read, so the editor fetches it when it opens.
 */
const BlogForm = ({ existing }: { existing?: Blog }) => {
  const full = useApi<Blog>(existing ? `admin/blogs/${existing.id}` : null, undefined, { enabled: !!existing })

  const [form, setForm] = useState({
    title: existing?.title ?? '',
    subheading: existing?.subheading ?? '',
    author: existing?.author ?? '',
    category: existing?.category ?? '',
    description: '',
    isPublished: existing?.published ?? false,
    regenerateSlug: false
  })

  const [touched, setTouched] = useState(false)
  const [file, setFile] = useState<File | null>(null)

  // Seed the body from the single-post read the first time it lands.
  if (full.data && !touched && form.description === '' && full.data.description) {
    setForm(f => ({ ...f, description: full.data.description ?? '' }))
    setTouched(true)
  }

  const save = useApiMutation({
    fn: () => {
      const fd = new FormData()

      fd.set('title', form.title)
      fd.set('description', form.description)
      for (const k of ['subheading', 'author', 'category'] as const) if (form[k]) fd.set(k, form[k])
      fd.set('isPublished', String(form.isPublished))
      if (existing && form.regenerateSlug) fd.set('regenerateSlug', 'true')
      if (file) fd.set('image', file)

      return existing ? api.upload<Blog>(`admin/blogs/${existing.id}`, fd, 'PATCH') : api.upload<Blog>('admin/blogs', fd, 'POST')
    },
    invalidate: [['paged', 'admin/blogs'], ['api', existing ? `admin/blogs/${existing.id}` : null]],
    success: existing ? 'Post updated' : 'Post created'
  })

  return (
    <FormDialog
      trigger={
        existing ? (
          <Button variant='ghost' size='icon-sm' aria-label='Edit'>
            <PencilIcon />
          </Button>
        ) : (
          <Button>
            <PlusIcon /> New post
          </Button>
        )
      }
      title={existing ? `Edit “${existing.title}”` : 'New blog post'}
      description={existing ? `Slug: ${existing.slug}` : 'The slug is generated from the title.'}
      submitLabel={existing ? 'Save' : 'Create'}
      onSubmit={() => save.mutateAsync()}
      validate={() => {
        if (existing && full.isLoading) return 'Wait for the current body to load'
        if (existing && full.error) return `Could not load the post body: ${errorMessage(full.error)}`

        return {
          'bl-title': check.required(form.title, 'Title') || check.length(form.title, 'Title', { max: 512 }),
          'bl-sub': check.length(form.subheading, 'Subheading', { max: 1000 }),
          'bl-author': check.length(form.author, 'Author', { max: 255 }),
          'bl-cat': check.length(form.category, 'Category', { max: 128 }),
          'bl-body': check.required(form.description, 'Body') || check.length(form.description, 'Body', { max: 200000 }),
          'bl-img': file && !file.type.startsWith('image/') ? 'The cover must be an image file' : file && file.size > 4 * 1024 * 1024 ? 'The cover image must be 4 MB or smaller' : undefined
        }
      }}
      wide
    >
      <TextField id='bl-title' name='title' label='Title' required maxLength={512} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
      <TextField id='bl-sub' label='Subheading' value={form.subheading} onChange={e => setForm({ ...form, subheading: e.target.value })} />
      <div className='grid grid-cols-2 gap-4'>
        <TextField id='bl-author' label='Author' value={form.author} onChange={e => setForm({ ...form, author: e.target.value })} />
        <TextField id='bl-cat' label='Category' value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} />
      </div>
      <TextAreaField
        id='bl-body'
        label='Body'
        required
        rows={12}
        hint={existing && full.isLoading ? 'Loading the current body…' : existing && full.error ? `Could not load the current body: ${errorMessage(full.error)}` : 'HTML or markdown, as the site renders it.'}
        value={form.description}
        onChange={e => {
          setTouched(true)
          setForm({ ...form, description: e.target.value })
        }}
      />
      <div className='grid gap-2'>
        <label htmlFor='bl-img' className='text-sm font-medium'>
          Cover image {existing ? '(leave empty to keep)' : ''}
        </label>
        <input id='bl-img' type='file' accept='image/*' className='text-sm' onChange={e => setFile(e.target.files?.[0] ?? null)} />
      </div>
      <SwitchField id='bl-pub' label='Published' hint='Unpublished posts are hidden from the site.' checked={form.isPublished} onChange={isPublished => setForm({ ...form, isPublished })} />
      {existing && <SwitchField id='bl-slug' label='Regenerate slug from the title' hint='Changes the post’s public URL — old links break.' checked={form.regenerateSlug} onChange={regenerateSlug => setForm({ ...form, regenerateSlug })} />}
    </FormDialog>
  )
}

const Blogs = () => {
  const { state, set, query } = useListState(['category'])
  const list = usePagedApi<Blog>('admin/blogs', { page: query.page, limit: query.limit, search: query.search, category: query.category })

  const remove = useApiMutation({
    fn: (id: number) => api.delete(`admin/blogs/${id}`),
    invalidate: [['paged', 'admin/blogs']],
    success: 'Post deleted'
  })

  const columns: Column<Blog>[] = [
    {
      key: 'title',
      header: 'Post',
      cell: b => (
        <span className='block max-w-96'>
          <span className='block truncate font-medium'>{b.title}</span>
          <span className='text-muted-foreground block truncate font-mono text-xs'>{b.slug}</span>
        </span>
      )
    },
    { key: 'cat', header: 'Category', cell: b => (b.category ? <Badge variant='outline'>{b.category}</Badge> : '—') },
    { key: 'author', header: 'Author', cell: b => b.author ?? '—' },
    { key: 'pub', header: 'Status', cell: b => <StatusBadge value={b.published ? 'published' : 'draft'} /> },
    { key: 'date', header: 'Date', cell: b => <DateTime value={b.date ?? b.createdAt} relative /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: b => (
        <Can permission='config:write'>
          <span className='flex justify-end gap-1'>
            <BlogForm existing={b} />
            <ConfirmDialog
              trigger={
                <Button variant='ghost' size='icon-sm' aria-label='Delete'>
                  <Trash2Icon />
                </Button>
              }
              title={`Delete “${b.title}”?`}
              description='The post and its image are removed. This cannot be undone.'
              confirmLabel='Delete'
              destructive
              onConfirm={() => remove.mutateAsync(b.id)}
            />
          </span>
        </Can>
      )
    }
  ]

  return (
    <div>
      <PageHeader
        title='Blogs'
        description='Articles the site renders under /blog. A draft is written and kept hidden until it is published.'
        actions={
          <Can permission='config:write'>
            <BlogForm />
          </Can>
        }
      />
      <DataTable
        columns={columns}
        rows={list.data?.rows}
        rowKey={b => b.id}
        loading={list.isLoading}
        fetching={list.isFetching}
        error={list.error}
        pagination={list.data?.pagination}
        onPageChange={page => set({ page })}
        onLimitChange={limit => set({ limit })}
        search={String(state.search ?? '')}
        onSearchChange={search => set({ search })}
        searchPlaceholder='Title or body…'
      />
    </div>
  )
}

export default Blogs
