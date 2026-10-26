'use client'

import PageHeader from '@/components/shared/PageHeader'
import { PriorityTab } from '@/views/casino/Curation'

/** Settings → Type Priority (admin-structure.zip): type chuno, uske games ko upar pin karo aur order set karo. */
const TypePriority = () => (
  <div>
    <PageHeader title='Type Priority' description='Pick a type to see all its games in the order the site shows them. Change a game’s image or its place (drag, or Top / ↑ / ↓ / Bottom), then Save.' />
    <PriorityTab kind='type' />
  </div>
)

export default TypePriority
