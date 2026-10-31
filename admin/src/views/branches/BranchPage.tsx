'use client'

import Link from 'next/link'

import { ArrowLeftIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'

import { BranchDetail, PlayerPage } from './BranchView'

const baseOf = (branchId: string) => `admin/branches/${encodeURIComponent(branchId)}`

/** The Super Admin's view of one branch: exactly what the branch sees in its own panel. */
const BranchPage = ({ branchId }: { branchId: string }) => (
  <BranchDetail
    base={baseOf(branchId)}
    playerHref={id => `/branches/${branchId}/users/${id}`}
    actions={
      <Button variant='outline' nativeButton={false} render={<Link href='/branches' />}>
        <ArrowLeftIcon /> All branches
      </Button>
    }
  />
)

/** One player of a branch, as the Super Admin sees it. */
export const BranchPlayerPage = ({ branchId, userId }: { branchId: string; userId: string }) => (
  <PlayerPage
    base={baseOf(branchId)}
    userId={userId}
    back={
      <Button variant='outline' nativeButton={false} render={<Link href={`/branches/${branchId}`} />}>
        <ArrowLeftIcon /> Back to branch
      </Button>
    }
  />
)

export default BranchPage
