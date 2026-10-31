'use client'

import { toast } from 'sonner'

import { errorMessage } from './client'

/** What `PUT /api/owner/entitlements` answers: the new document, what moved, and that the site has it. */
export type SaveResult = { doc: { version: number }; changes: unknown[]; live?: { live: boolean; version?: number; reason?: string } }

/**
 * The one toast after a save of the entitlements document (Features & plan, Coins, Branding):
 * the new version, live on the site (the backend stored and applied it before answering; a save
 * it refused is an error toast instead).
 */
export function toastSaved(r: SaveResult, what = 'Saved') {
  if (!r.changes.length) {
    toast.info('Nothing to save', { description: 'The stored version already matches; no new version was written.' })

    return
  }

  const n = r.changes.length
  const title = `${what} — version v${r.doc.version} (${n} change${n === 1 ? '' : 's'})`

  toast.success(title, { description: 'The site backend stored and applied it: live on the site now.' })
}

/** An error toast with the server's message in plain words (lib/api/client.ts errorMessage). */
export function toastError(error: unknown, title?: string) {
  const message = errorMessage(error)

  if (title) toast.error(title, { description: message })
  else toast.error(message)
}
