import { Suspense } from 'react'

import PlayersList from '@/views/players/PlayersList'

export const metadata = { title: 'Users' }

export default function Page() {
  return (
    <Suspense>
      <PlayersList />
    </Suspense>
  )
}
