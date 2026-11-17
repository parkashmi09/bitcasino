'use client'

import { useState, type ReactNode } from 'react'

import { UsersIcon, NetworkIcon } from 'lucide-react'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSession } from '@/contexts/SessionContext'

/** Player kis taraf ka: direct = site pe khud bana (koi parent nahi), agent = Sports Exchange agent ke neeche. */
export type Channel = 'direct' | 'agent'

/**
 * Jis list / history me direct aur agent dono ke users aa sakte hain, uske upar do tab:
 * **Direct Users | Agent Users** — dono ki listing alag (API ko `channel=direct|agent`).
 * Tab badalne pe list naye sire se mount hoti hai (page / filters purane tab ke nahi rehte).
 *
 *   <ChannelTabs>{channel => <BetList channel={channel} />}</ChannelTabs>
 */
const ChannelTabs = ({ children, className }: { children: (channel: Channel) => ReactNode; className?: string }) => {
  const { actor, businessModel } = useSession()
  const direct = actor?.direct === true
  const [channel, setChannel] = useState<Channel>('direct')

  // Direct users are the Super Admin's (and its executives') only: everyone else gets the agent list, no tabs.
  // A B2B site has no direct users and a B2C site no agent users: one side only, no tabs.
  if (!direct || businessModel === 'b2b') return <div className={className}>{children('agent')}</div>
  if (businessModel === 'b2c') return <div className={className}>{children('direct')}</div>

  return (
    <div className={className}>
      <Tabs value={channel} onValueChange={v => setChannel(v === 'agent' ? 'agent' : 'direct')}>
        <TabsList variant='segmented' className='mb-6'>
          <TabsTrigger value='direct'>
            <UsersIcon /> Direct Users
          </TabsTrigger>
          <TabsTrigger value='agent'>
            <NetworkIcon /> Agent Users
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <div key={channel}>{children(channel)}</div>
    </div>
  )
}

export default ChannelTabs
