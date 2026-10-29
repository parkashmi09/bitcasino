'use client'

import { useState } from 'react'

import Link from 'next/link'
import { CheckIcon, XIcon } from 'lucide-react'

import Can from '@/components/shared/Can'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import ErrorState from '@/components/shared/ErrorState'
import FormDialog from '@/components/shared/FormDialog'
import { TextAreaField } from '@/components/shared/FormField'
import StatusBadge from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { check } from '@/lib/validate'

/** `admin/user/kyc-levels` — the user-service kyc-levels module (rainbet). */
const BASE = 'admin/user/kyc-levels'

type LevelRow = {
  id: string
  userId: string
  player: string | null
  level: 3 | 4
  label: string
  status: 'Pending' | 'Verified' | 'Rejected'
  rejectionReason: string | null
  submittedAt: string
}

const Reject = ({ row }: { row: LevelRow }) => {
  const [reason, setReason] = useState('')

  const reject = useApiMutation({
    fn: () => api.put(`${BASE}/${row.id}`, { status: 'Rejected', rejectionReason: reason.trim() }),
    invalidate: [['api', BASE]],
    success: 'Rejected'
  })

  return (
    <FormDialog
      trigger={
        <Button variant='ghost' size='sm'>
          <XIcon /> Reject
        </Button>
      }
      title={`Reject ${row.label}`}
      description='The player sees the reason and can send a new document.'
      submitLabel='Reject'
      onSubmit={() => reject.mutateAsync()}
      validate={() => ({ 'kl-reason': check.required(reason, 'Reason') })}
    >
      <TextAreaField id='kl-reason' label='Reason' required value={reason} onChange={e => setReason(e.target.value)} />
    </FormDialog>
  )
}

/** Levels 3 and 4 — proof of address and source of income, after the identity KYC. */
const KycLevelsQueue = () => {
  const list = useApi<LevelRow[]>(BASE, { limit: 100 })
  const approve = useApiMutation({ fn: (id: string) => api.put(`${BASE}/${id}`, { status: 'Verified' }), invalidate: [['api', BASE]], success: 'Verified' })

  const columns: Column<LevelRow>[] = [
    { key: 'at', header: 'Submitted', cell: r => <DateTime value={r.submittedAt} /> },
    {
      key: 'player',
      header: 'Player',
      cell: r => (
        <Link href={`/users/${r.userId}`} className='hover:underline'>
          {r.player ?? `#${r.userId}`}
        </Link>
      )
    },
    { key: 'level', header: 'Level', cell: r => `Level ${r.level} — ${r.label}` },
    {
      key: 'doc',
      header: 'Document',
      cell: r => (
        <a href={api.url(`${BASE}/${r.id}/document`)} target='_blank' rel='noreferrer' className='text-sm hover:underline'>
          Open
        </a>
      )
    },
    { key: 'status', header: 'Status', cell: r => <StatusBadge value={r.status} /> },
    {
      key: 'act',
      header: '',
      align: 'right',
      cell: r =>
        r.status === 'Pending' ? (
          <Can permission='users:write'>
            <div className='flex justify-end gap-1'>
              <ConfirmDialog
                trigger={
                  <Button variant='ghost' size='sm'>
                    <CheckIcon /> Approve
                  </Button>
                }
                title={`Approve ${r.label}?`}
                description={`Marks Level ${r.level} verified for ${r.player ?? r.userId}.`}
                confirmLabel='Approve'
                onConfirm={() => approve.mutateAsync(r.id)}
              />
              <Reject row={r} />
            </div>
          </Can>
        ) : (
          <span className='text-muted-foreground text-xs'>{r.rejectionReason ?? ''}</span>
        )
    }
  ]

  return (
    <Card className='mt-6 shadow-none'>
      <CardHeader>
        <CardTitle className='text-base'>Levels 3–4 — proof of address and source of income</CardTitle>
      </CardHeader>
      <CardContent>
        {list.error ? <ErrorState error={list.error} /> : <DataTable columns={columns} rows={list.data} loading={!list.data} rowKey={r => r.id} emptyMessage='Nothing submitted yet.' />}
      </CardContent>
    </Card>
  )
}

export default KycLevelsQueue
