/**
 * Sports tree ka shape — zip ka `utils/sportsTreeShape.js` (shapeSportsEvents + groupRaces).
 *
 * `/user/all/sports/events` already sahi order me deta hai (sports feed order, racing Tennis
 * ke baad, leagues soonest match se). Yahan sirf racing ko country ke neeche group karte hain.
 */

export type TreeMatch = { etid: number | string; gmid: string; name: string; sdatetime?: string }
export type TreeSeries = { cid?: string; name: string; children: TreeMatch[] }
export type TreeSport = { etid: number | string; name: string; children: TreeSeries[] }

type RawSport = { etid: number | string; name: string; children?: (TreeSeries | TreeMatch)[] | null }

/** Horse race ka label "Venue-HH:mm:ss DD/MM/YYYY"; greyhound sirf venue (zip raceLabel). */
function raceLabel(etid: number | string, race: TreeMatch) {
  const venue = String(race.name || '').replace(/\s*\([A-Z]{2,3}\)\s*$/, '').trim()

  if (String(etid) !== '10') return venue
  const m = String(race.sdatetime || '').match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s*(AM|PM)?$/i)

  if (!m) return venue
  const [, mm, dd, yyyy, hhRaw, mi, ss, ap] = m
  let hh = Number(hhRaw)

  if (ap?.toUpperCase() === 'PM' && hh !== 12) hh += 12
  if (ap?.toUpperCase() === 'AM' && hh === 12) hh = 0

  return `${venue}-${String(hh).padStart(2, '0')}:${mi}:${ss} ${dd}/${mm}/${yyyy}`
}

/** Racing ki races flat aati hain — country code "(GB)" ke neeche group, label A→Z. */
function groupRaces(sport: RawSport): TreeSport {
  // Jis sport me abhi koi match nahi, feed `children: null` bhejta hai — khali list bana do
  const list = sport.children ?? []

  if (!list.length || 'children' in list[0]) {
    return { ...sport, children: (list as TreeSeries[]).map(s => ({ ...s, children: s.children ?? [] })) }
  }

  const byCode = new Map<string, TreeMatch[]>()

  for (const race of list as TreeMatch[]) {
    const code = String(race.name || '').match(/\(([A-Z]{2,3})\)\s*$/)?.[1] ?? 'ALL'

    if (!byCode.has(code)) byCode.set(code, [])
    byCode.get(code)!.push({ ...race, name: raceLabel(sport.etid, race) })
  }

  return {
    etid: sport.etid,
    name: sport.name,
    children: [...byCode].map(([code, races]) => ({
      cid: `race-${sport.etid}-${code}`,
      name: code,
      children: [...races].sort((a, b) => a.name.localeCompare(b.name, 'en'))
    }))
  }
}

export const shapeSportsEvents = (sports: RawSport[] | undefined) => (sports ?? []).map(groupRaces)

/** Sport me total matches — sidebar ka "(n)". */
export const matchCount = (sport: TreeSport) => (sport.children ?? []).reduce((sum, s) => sum + (s.children?.length ?? 0), 0)
