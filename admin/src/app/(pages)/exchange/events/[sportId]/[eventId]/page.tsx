import { Suspense } from 'react'

import GameDetails from '@/views/exchange/market/GameDetails'

export const metadata = { title: 'Game Details' }

type Props = { params: Promise<{ sportId: string; eventId: string }> }

export default async function Page({ params }: Props) {
  const { sportId, eventId } = await params

  return (
    <Suspense>
      <GameDetails key={`${sportId}-${eventId}`} sportId={sportId} eventId={eventId} />
    </Suspense>
  )
}
