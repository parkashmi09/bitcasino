import { Suspense } from 'react'

import PageHeader from '@/components/shared/PageHeader'
import { Card } from '@/components/ui/card'
import EventsTree from '@/views/exchange/market/EventsTree'

export const metadata = { title: 'Events' }

/** Zip ke sidebar ka "Events" tree — sport → series → match, match pe click = Game Details. */
export default function Page() {
  return (
    <div>
      <PageHeader title='Events' />
      <Card size='sm' className='max-w-2xl p-0'>
        <Suspense>
          <EventsTree />
        </Suspense>
      </Card>
    </div>
  )
}
