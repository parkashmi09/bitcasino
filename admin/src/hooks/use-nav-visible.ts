'use client'

import { useCallback } from 'react'

import { firstNavHref, type NavMarks } from '@/configs/navConfig'
import { useSession } from '@/contexts/SessionContext'

/**
 * Whether a menu entry is shown to this session: what the role can reach, what the operator
 * switched on and what the owner put in the plan. A flag or entitlement that has not loaded yet
 * (or is not readable) hides nothing. The sidebar and the landing route share it.
 */
export function useNavVisible() {
  const { actor, can, flags, featureEntitled, flagEntitled, policyOn } = useSession()
  const isMarketing = actor?.marketing === true

  // Agent-tree logins (levels 4–6 and their executives) see no promotions anywhere.
  const promotionsAllowed = actor?.promotions === true
  const directAllowed = actor?.direct === true

  return useCallback(
    (entry: NavMarks) =>
      (entry.account !== 'marketing' || isMarketing) &&
      (!entry.promotions || promotionsAllowed) &&
      (!entry.direct || directAllowed) &&
      (!entry.notExecutive || !actor?.executiveId) &&
      can(entry.permission) &&

      // `ownerFlag` (e.g. the Sports switch) only follows the owner's plan, never the operator's own
      // switch — otherwise turning sports off would hide the one screen that turns it back on.
      (!entry.flag || (flags[entry.flag] !== false && flagEntitled(entry.flag))) &&
      (!entry.ownerFlag || flagEntitled(entry.ownerFlag)) &&
      featureEntitled(entry.feature) &&
      policyOn(entry.policy),
    [can, flags, featureEntitled, flagEntitled, policyOn, isMarketing, promotionsAllowed, directAllowed, actor?.executiveId]
  )
}

/** The first page this session can actually open — where sign-in lands. */
export function useHomeHref() {
  return firstNavHref(useNavVisible())
}

/** Whether the spin wheel / lucky spin is on for this site — the same test as its menu entry. */
export function useSpinWheelOn() {
  const { flags, featureEntitled, flagEntitled } = useSession()

  return flags.wheelspin !== false && flagEntitled('wheelspin') && featureEntitled('spin_wheel')
}
