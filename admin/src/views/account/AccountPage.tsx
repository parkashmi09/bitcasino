'use client'

import { useState } from 'react'

import { PlusIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { siteConfig } from '@/configs/site'
import { useSession } from '@/contexts/SessionContext'
import { formatIn, useReportMoney } from '@/components/shared/ReportMoney'
import { useApi } from '@/hooks/use-api'
import OwnerAddBalance from '@/views/exchange/OwnerAddBalance'
import type { OwnerWallet } from '@/views/exchange/types'
import MyAccount from './MyAccount'

/** Owner ke do wallet (zip My Account ka "Add amount") — header wala Add Balance popup. */
const OwnerWalletCard = () => {
  const [open, setOpen] = useState(false)
  const { data } = useApi<OwnerWallet>('admin/exchange/owner/wallet')

  // Both wallets are kept in INR; shown in the owner's default coin, the INR figure underneath.
  const money = useReportMoney()
  const inrLine = (v: string | number | undefined) => <div className='text-muted-foreground text-xs tabular-nums'>{formatIn(Number(v ?? 0), 'INR')}</div>

  return (
    <Card className='mb-6 shadow-none'>
      <CardContent className='flex flex-wrap items-center gap-6 p-5'>
        <div>
          <div className='text-muted-foreground text-xs'>Agent System balance</div>
          <div className='text-xl font-bold tabular-nums'>{money.format(data?.wallet.balance ?? 0, 'INR')}</div>
          {money.code !== 'INR' && inrLine(data?.wallet.balance)}
        </div>
        <div>
          <div className='text-muted-foreground text-xs'>Direct Users balance</div>
          <div className='text-xl font-bold tabular-nums'>{money.format(data?.directBalance ?? 0, 'INR')}</div>
          {money.code !== 'INR' && inrLine(data?.directBalance)}
        </div>
        <Button className='ml-auto' onClick={() => setOpen(true)}>
          <PlusIcon /> {siteConfig.whitelabel ? 'Move to Agent System' : 'Add Balance'}
        </Button>
        <OwnerAddBalance open={open} onOpenChange={setOpen} />
      </CardContent>
    </Card>
  )
}

/** Settings → My account. Super Admin ko upar dono wallet + Add Balance (pehle Agent System → My Account tab me tha). */
const AccountPage = () => {
  const { can } = useSession()

  return (
    <div>
      {can('wallet:adjust') && <OwnerWalletCard />}
      <MyAccount />
    </div>
  )
}

export default AccountPage
