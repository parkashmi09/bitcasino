'use client'

/**
 * rainbet: an HTML field edited as formatted text — headings, bold / italic / underline, lists,
 * links — with an "HTML" switch to edit the source itself. The value stays an HTML string, exactly
 * what a plain textarea of HTML held, so the backend and the player site see no difference.
 * Built on contentEditable + document.execCommand (no editor dependency).
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'

import {
  BoldIcon,
  CodeIcon,
  Heading2Icon,
  Heading3Icon,
  ItalicIcon,
  Link2OffIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  PilcrowIcon,
  RemoveFormattingIcon,
  UnderlineIcon
} from 'lucide-react'

import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

import { Message, useFieldError } from './FormField'

type Props = {
  id: string
  name?: string
  label: ReactNode
  hint?: ReactNode
  required?: boolean
  error?: string | false | null
  value: string
  onChange: (html: string) => void
  placeholder?: string
  minHeight?: number
}

const Tool = ({ title, onRun, active = false, children }: { title: string; onRun: () => void; active?: boolean; children: ReactNode }) => (
  <button
    type='button'
    title={title}
    aria-label={title}

    // Keep the text selection: act on mouse-down, before the editor loses focus.
    onMouseDown={e => {
      e.preventDefault()
      onRun()
    }}
    className={cn('hover:bg-accent inline-flex size-8 items-center justify-center rounded-md', active && 'bg-accent text-accent-foreground')}
  >
    {children}
  </button>
)

export const RichTextField = ({ id, name, label, hint, required, error, value, onChange, placeholder, minHeight = 220 }: Props) => {
  const { message, clear } = useFieldError(id, name, error)
  const [source, setSource] = useState(false)
  const editor = useRef<HTMLDivElement>(null)

  // Follow `value` only when it changed from outside (loaded, edited as HTML) — typing keeps its caret.
  useEffect(() => {
    const el = editor.current

    if (el && !source && el.innerHTML !== value) el.innerHTML = value
  }, [value, source])

  const emit = () => {
    clear()
    onChange(editor.current?.innerHTML ?? '')
  }

  const run = (command: string, arg?: string) => {
    editor.current?.focus()
    document.execCommand(command, false, arg)
    emit()
  }

  const link = () => {
    const url = window.prompt('Link address — a site path (/casino) or https://…')

    if (url?.trim()) run('createLink', url.trim())
  }

  return (
    <Field className='gap-2' data-invalid={message ? true : undefined}>
      <FieldLabel htmlFor={id}>
        {label}
        {required && ' *'}
      </FieldLabel>
      <div className={cn('rounded-md border', message && 'border-destructive')}>
        <div className='bg-muted/40 flex flex-wrap items-center gap-0.5 border-b p-1'>
          {!source && (
            <>
              <Tool title='Paragraph' onRun={() => run('formatBlock', 'p')}>
                <PilcrowIcon className='size-4' />
              </Tool>
              <Tool title='Heading' onRun={() => run('formatBlock', 'h2')}>
                <Heading2Icon className='size-4' />
              </Tool>
              <Tool title='Subheading' onRun={() => run('formatBlock', 'h3')}>
                <Heading3Icon className='size-4' />
              </Tool>
              <span className='bg-border mx-1 h-5 w-px' />
              <Tool title='Bold' onRun={() => run('bold')}>
                <BoldIcon className='size-4' />
              </Tool>
              <Tool title='Italic' onRun={() => run('italic')}>
                <ItalicIcon className='size-4' />
              </Tool>
              <Tool title='Underline' onRun={() => run('underline')}>
                <UnderlineIcon className='size-4' />
              </Tool>
              <span className='bg-border mx-1 h-5 w-px' />
              <Tool title='Bullet list' onRun={() => run('insertUnorderedList')}>
                <ListIcon className='size-4' />
              </Tool>
              <Tool title='Numbered list' onRun={() => run('insertOrderedList')}>
                <ListOrderedIcon className='size-4' />
              </Tool>
              <Tool title='Link' onRun={link}>
                <LinkIcon className='size-4' />
              </Tool>
              <Tool title='Remove link' onRun={() => run('unlink')}>
                <Link2OffIcon className='size-4' />
              </Tool>
              <Tool title='Clear formatting' onRun={() => run('removeFormat')}>
                <RemoveFormattingIcon className='size-4' />
              </Tool>
            </>
          )}
          <span className='ml-auto' />
          <Tool title={source ? 'Back to the editor' : 'Edit the HTML'} active={source} onRun={() => setSource(s => !s)}>
            <CodeIcon className='size-4' />
          </Tool>
        </div>
        {source ? (
          <Textarea
            id={id}
            name={name}
            value={value}
            onChange={e => {
              clear()
              onChange(e.target.value)
            }}
            className='rounded-none border-0 font-mono text-xs shadow-none focus-visible:ring-0'
            style={{ minHeight }}
          />
        ) : (
          <div
            id={id}
            ref={editor}
            role='textbox'
            aria-multiline='true'
            aria-required={required || undefined}
            aria-invalid={message ? true : undefined}
            aria-describedby={message ? `${id}-error` : undefined}
            contentEditable
            suppressContentEditableWarning
            data-placeholder={placeholder ?? 'Write here…'}
            onInput={emit}
            onBlur={emit}
            className={cn(
              'max-w-none overflow-auto px-3 py-2 text-sm outline-none',
              'empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]',
              '[&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:font-semibold',
              '[&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5',
              '[&_a]:text-primary [&_a]:underline'
            )}
            style={{ minHeight }}
          />
        )}
      </div>
      <Message id={id} message={message} />
      {hint && <FieldDescription>{hint}</FieldDescription>}
    </Field>
  )
}

export default RichTextField
