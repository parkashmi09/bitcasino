import { Suspense } from 'react'

import PlayerDetail from '@/views/players/PlayerDetail'

export const metadata = { title: 'User' }

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return (
    <Suspense>
      <PlayerDetail id={id} />
    </Suspense>
  )
}
