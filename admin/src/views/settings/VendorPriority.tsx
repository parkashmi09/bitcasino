'use client'

import PageHeader from '@/components/shared/PageHeader'
import { PriorityTab } from '@/views/casino/Curation'

/** Settings → Vendor Priority (admin-structure.zip): vendor chuno, uske games ko upar pin karo aur order set karo. */
const VendorPriority = () => (
  <div>
    <PageHeader title='Vendor Priority' description='Pick a vendor to see all its games in the order the site shows them. Change a game’s image or its place (drag, or Top / ↑ / ↓ / Bottom), then Save.' />
    <PriorityTab kind='vendor' />
  </div>
)

export default VendorPriority
