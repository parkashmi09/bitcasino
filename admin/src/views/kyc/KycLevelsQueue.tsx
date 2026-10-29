'use client'

import { useState } from 'react'

import Link from 'next/link'
import { CheckIcon, XIcon } from 'lucide-react'

import Can from '@/components/shared/Can'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import FormDialog from '@/components/shared/FormDialog'
import { TextAreaField } from '@/components/shared/FormField'
import StatusBadge from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { formatDate } from '@/lib/format'
import { check } from '@/lib/validate'

/**
 * KYC Levels 3 and 4 (rainbet) — proof of address and source of income, after the identity KYC.
 * `admin/user/kyc-levels` is the user-service kyc-levels module. The rows are drawn in the KYC
 * page's own table (`KycQueue.tsx`), under the same status tabs as Levels 1–2.
 */
const BASE = 'admin/user/kyc-levels'

export type LevelRow = {
  id: string
  userId: string
  player: string | null
  level: 3 | 4
  label: string
  status: 'Pending' | 'Verified' | 'Rejected'
  rejectionReason: string | null
  submittedAt: string
  reviewedAt: string | null
}

/** The Level 3–4 submissions with `status` (all when none). At most 200: the queue is small. */
export const useLevelRows = (status?: string) => useApi<LevelRow[]>(BASE, { limit: 200, status })

const documentUrl = (row: LevelRow) => api.url(`${BASE}/${row.id}/document`)

/**
 * The document: an image shows as a picture (click for full size); anything else (a PDF) fails
 * to load as an image and falls back to an Open link.
 */
export const DocumentPreview = ({ row, className = 'h-12 w-16' }: { row: LevelRow; className?: string }) => {
  const [isImage, setIsImage] = useState(true)

  return (
    <a href={documentUrl(row)} target='_blank' rel='noreferrer' className='text-sm hover:underline' onClick={e => e.stopPropagation()}>
      {isImage ? (
         
        <img src={documentUrl(row)} alt={`${row.label} document`} className={`bg-muted rounded object-contain ${className}`} onError={() => setIsImage(false)} />
      ) : (
        'Open file'
      )}
    </a>
  )
}

/** One Level 3–4 submission: the document large, then Approve / Reject while it is Pending. */
export const LevelDetail = ({ row, onClose }: { row: LevelRow | null; onClose: () => void }) => {
  const [reason, setReason] = useState('')

  const review = useApiMutation({
    fn: (status: 'Verified' | 'Rejected') => api.put(`${BASE}/${row?.id}`, { status, ...(status === 'Rejected' ? { rejectionReason: reason.trim() } : {}) }),
    invalidate: [['api', BASE]],
    success: (_r, status) => `Level ${row?.level} marked ${status}`,
    onSuccess: () => {
      setReason('')
      onClose()
    }
  })

  return (
    <Dialog open={!!row} onOpenChange={o => !o && onClose()}>
      <DialogContent className='sm:max-w-2xl'>
        {row && (
          <>
            <DialogHeader>
              <DialogTitle className='flex items-center gap-2'>
                Level {row.level} — {row.label} <StatusBadge value={row.status} />
              </DialogTitle>
              <DialogDescription>
                {row.player ?? 'Player'} · user <Link href={`/users/${row.userId}`} className='underline'>#{row.userId}</Link> · submitted {formatDate(row.submittedAt)}
              </DialogDescription>
            </DialogHeader>
            {row.rejectionReason && <p className='text-sm'>Rejected: {row.rejectionReason}</p>}
            <div className='rounded-md border p-2'>
              <DocumentPreview row={row} className='h-96 w-full' />
            </div>
            {row.status === 'Pending' && (
              <Can permission='users:write'>
                <div className='flex justify-end gap-2'>
                  <FormDialog
                    trigger={
                      <Button variant='destructive'>
                        <XIcon /> Reject
                      </Button>
                    }
                    title={`Reject ${row.label}`}
                    description='The player sees the reason and can send a new document.'
                    submitLabel='Reject'
                    destructive
                    validate={() => ({ 'kl-reason': check.required(reason, 'Reason') })}
                    onSubmit={() => review.mutateAsync('Rejected')}
                  >
                    <TextAreaField id='kl-reason' label='Reason' required value={reason} onChange={e => setReason(e.target.value)} />
                  </FormDialog>
                  <ConfirmDialog
                    trigger={
                      <Button>
                        <CheckIcon /> Approve
                      </Button>
                    }
                    title={`Approve ${row.label}?`}
                    description={`Marks Level ${row.level} verified for ${row.player ?? row.userId}.`}
                    confirmLabel='Approve'
                    onConfirm={() => review.mutateAsync('Verified')}
                  />
                </div>
              </Can>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
