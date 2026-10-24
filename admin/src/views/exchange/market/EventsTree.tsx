'use client'

import { useMemo, useState } from 'react'

import Link from 'next/link'

import { ChevronRightIcon } from 'lucide-react'

import ErrorState from '@/components/shared/ErrorState'
import { Skeleton } from '@/components/ui/skeleton'
import { useApi } from '@/hooks/use-api'
import { cn } from '@/lib/utils'
import { SPORTS_USER } from './api'
import { matchCount, shapeSportsEvents, type TreeSport } from './sportsTree'

type Props = {

  /** Khula hua match (Game Details) — uski sport + league apne aap khulti hai. */
  activeSportId?: string
  activeEventId?: string
}

const sportKey = (etid: string | number) => `sport-${etid}`
const seriesKey = (etid: string | number, index: number) => `ser-${etid}-${index}`

/**
 * Events tree — zip ke sidebar (components/Layout.jsx) ka sports → series → match tree.
 *
 * Ek waqt me ek hi sport khulti hai (dusri sport kholo to pehli band). League apni sport ke
 * andar alag alag khulti/band hoti hai. Match pe click = Game Details.
 */
const EventsTree = ({ activeSportId, activeEventId }: Props) => {
  const { data, error, isLoading } = useApi<{ sports: Parameters<typeof shapeSportsEvents>[0] }>(`${SPORTS_USER}/all/sports/events`)
  const sports: TreeSport[] = useMemo(() => shapeSportsEvents(data?.sports), [data])

  // khula match jis league me hai wo branch shuru me khuli (jab tak user khud na chhede)
  const autoOpen = useMemo(() => {
    const sport = sports.find(s => String(s.etid) === String(activeSportId))
    const index = sport?.children.findIndex(ser => ser.children.some(m => String(m.gmid) === String(activeEventId))) ?? -1

    return sport && index >= 0 ? { [sportKey(sport.etid)]: true, [seriesKey(sport.etid, index)]: true } : {}
  }, [sports, activeSportId, activeEventId])

  const [touched, setTouched] = useState<Record<string, boolean> | null>(null)
  const open = touched ?? autoOpen

  // sport: akeli khulti hai; series: apni sport ki baaki series waise hi rehti hain
  const toggle = (key: string) =>
    setTouched(current => {
      const prev = current ?? autoOpen

      if (prev[key]) return Object.fromEntries(Object.entries(prev).filter(([k]) => k !== key && !k.startsWith(key.replace('sport-', 'ser-') + '-')))
      if (key.startsWith('sport-')) return { [key]: true }
      const sportPrefix = `ser-${key.split('-')[1]}-`
      const keep = Object.entries(prev).filter(([k, v]) => v && (k.startsWith('sport-') || k.startsWith(sportPrefix)))

      return { ...Object.fromEntries(keep), [key]: true }
    })

  if (error) return <ErrorState error={error} />
  if (isLoading) return <Skeleton className='h-64 w-full' />

  return (
    <ul className='flex flex-col text-sm'>
      {sports.map(sport => {
        const sKey = sportKey(sport.etid)
        const total = matchCount(sport)
        const sportOpen = Boolean(open[sKey])

        return (
          <li key={sKey} className='border-b last:border-b-0'>
            <button
              type='button'
              onClick={() => total && toggle(sKey)}
              className={cn('flex w-full items-center gap-1.5 px-3 py-2 text-left font-medium', sportOpen ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
            >
              {total ? <ChevronRightIcon className={cn('size-4 transition-transform', sportOpen && 'rotate-90')} /> : <span className='w-4' />}
              <span>{sport.name}</span>
              {total ? <span className='opacity-80'>({total})</span> : null}
            </button>

            {sportOpen && (
              <ul className='bg-muted/40'>
                {sport.children.map((series, index) => {
                  const serKey = seriesKey(sport.etid, index)
                  const serOpen = Boolean(open[serKey])

                  return (
                    <li key={serKey}>
                      <button
                        type='button'
                        onClick={() => toggle(serKey)}
                        className={cn('flex w-full items-center gap-1.5 py-1.5 pr-3 pl-6 text-left', serOpen ? 'bg-primary/15 font-medium' : 'hover:bg-muted')}
                      >
                        <ChevronRightIcon className={cn('size-3.5 transition-transform', serOpen && 'rotate-90')} />
                        <span>{series.name}</span>
                        <span className='text-muted-foreground'>({series.children.length})</span>
                      </button>

                      {serOpen && (
                        <ul>
                          {series.children.map(match => {
                            const active = String(match.gmid) === String(activeEventId)

                            return (
                              <li key={match.gmid}>
                                <Link
                                  href={`/exchange/events/${sport.etid}/${match.gmid}`}
                                  className={cn('block py-1.5 pr-3 pl-11', active ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted')}
                                >
                                  {match.name}
                                </Link>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export default EventsTree
