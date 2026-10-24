'use client'

import PageHeader from '@/components/shared/PageHeader'
import { PriorityTab } from '@/views/casino/Curation'

/** Settings → Vendor Priority (admin-structure.zip): vendor chuno, uske games ko upar pin karo aur order set karo. */
const VendorPriority = () => (
  <div>
    <PageHeader title='Vendor Priority' description='Pick a vendor and pin games to the top of its list. Top / ↑ / ↓ / Bottom, add or remove, then Save.' />
    <PriorityTab kind='vendor' />
  </div>
)

export default VendorPriority
