'use client'

import PageHeader from '@/components/shared/PageHeader'
import { CollectionsTab } from '@/views/casino/Curation'

/** Settings → Providers Priority (admin-structure.zip): home ke collections (Hot, Live casino, Popular slots, Crash) me games ka order. */
const ProvidersPriority = () => (
  <div>
    <PageHeader title='Providers Priority' description='Order the games in each home collection. Top / ↑ / ↓ / Bottom, add or remove, then Save.' />
    <CollectionsTab />
  </div>
)

export default ProvidersPriority
