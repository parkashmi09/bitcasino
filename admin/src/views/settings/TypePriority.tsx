'use client'

import PageHeader from '@/components/shared/PageHeader'
import { PriorityTab } from '@/views/casino/Curation'

/** Settings → Type Priority (admin-structure.zip): type chuno, uske games ko upar pin karo aur order set karo. */
const TypePriority = () => (
  <div>
    <PageHeader title='Type Priority' description='Pick a type and pin games to the top of its list. Top / ↑ / ↓ / Bottom, add or remove, then Save.' />
    <PriorityTab kind='type' />
  </div>
)

export default TypePriority
