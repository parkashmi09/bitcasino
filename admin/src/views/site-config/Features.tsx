'use client'

import { useMemo, useState } from 'react'

import { InfoIcon, Loader2Icon, LockIcon, SendIcon, SettingsIcon } from 'lucide-react'

import ErrorState from '@/components/shared/ErrorState'
import FormDialog from '@/components/shared/FormDialog'
import { TextField } from '@/components/shared/FormField'
import PageHeader from '@/components/shared/PageHeader'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { UI_LABEL, uiSupport } from '@/configs/siteUi'
import { useSession } from '@/contexts/SessionContext'
import { useLivePoll } from '@/lib/realtime-status'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  OWNER_MANAGED_MESSAGE,
  type Catalogue,
  type CatalogueFeature,
  type SiteFeature,
  type SiteFeatures
} from './featureTypes'

/** `admin/casino/original-games/games`: one Original game and its own switch. */
type OriginalGame = { gameCode: string; name: string; enabled: boolean; image: string | null }

const ORIGINALS = 'admin/casino/original-games/games'

/** The Super Admin's on/off for a feature in the plan (the variant stays the platform's). */
const FeatureSwitch = ({ spec, on }: { spec: CatalogueFeature; on: boolean }) => {
  const save = useApiMutation({
    fn: (enabled: boolean) => api.put(`admin/features/${spec.key}`, { enabled }),
    invalidate: [['api', 'admin/features']],
    success: (_r, enabled) => `${spec.label} ${enabled ? 'on' : 'off'}`
  })

  return <Switch checked={on} disabled={save.isPending} onCheckedChange={v => save.mutate(v)} aria-label={`${spec.label} on or off`} />
}

/** Original games, one switch each: off takes the game out of the lobby and refuses its launch. */
const OriginalGames = ({ canWrite }: { canWrite: boolean }) => {
  const games = useApi<OriginalGame[]>(ORIGINALS)

  const save = useApiMutation({
    fn: ({ gameCode, enabled }: { gameCode: string; enabled: boolean }) => api.put(`${ORIGINALS}/${gameCode}`, { enabled }),
    invalidate: [['api', ORIGINALS]],
    success: (_r, v) => `${v.gameCode} ${v.enabled ? 'on' : 'off'}`
  })

  if (games.error) return <ErrorState error={games.error} />
  if (!games.data?.length) return null

  return (
    <Card className='gap-0 py-0 shadow-none'>
      <CardHeader className='border-b py-3'>
        <CardTitle className='text-muted-foreground text-xs font-semibold tracking-wider uppercase'>Original games</CardTitle>
      </CardHeader>
      <Table>
        <TableBody>
          {games.data.map(g => (
            <TableRow key={g.gameCode}>
              <TableCell className='pl-4 font-medium'>
                {g.name}
                <span className='text-muted-foreground block font-mono text-xs'>{g.gameCode}</span>
              </TableCell>
              <TableCell className='pr-4 text-right'>
                {canWrite ? (
                  <Switch checked={g.enabled} disabled={save.isPending} onCheckedChange={enabled => save.mutate({ gameCode: g.gameCode, enabled })} aria-label={`${g.name} on or off`} />
                ) : (
                  <Badge variant={g.enabled ? 'default' : 'outline'}>{g.enabled ? 'On' : 'Off'}</Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}

/** How often the features read is refreshed so what the platform changes shows up live. */

/** Not shown to the site admin: the owner's commercial setup (incl. which games provider), and features this backend does not have. */
const OWNER_ONLY_FEATURES = new Set(['business_model', 'raffles', 'casino_aggregator', 'slotegrator_inr_as_pkr', 'api_encryption', 'rate_limit', 'branch_management', 'whitelabel', 'deposit_email_verification', 'google_signin'])
const FEATURES_POLL_MS = 15_000

/** The variant's label as staff see it (read-only: the platform picks the variant). */
const variantLabel = (spec: CatalogueFeature, cur: SiteFeature) =>
  spec.variants.find(v => v.key === cur.variant)?.label ?? cur.variantLabel ?? cur.variant

/**
 * Keys for the variant the platform chose (e.g. push notification App ID / API key). Staff may
 * still key these in; the variant and the on/off switch are the platform's alone, so neither is
 * sent — the backend keeps both as they are.
 */
const IntegrationSettings = ({ feature, current }: { feature: CatalogueFeature; current: SiteFeature }) => {
  const spec = feature.variants.find(v => v.key === current.variant)
  const [config, setConfig] = useState<Record<string, string>>(current.config ?? {})
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [testUser, setTestUser] = useState('')

  const save = useApiMutation({
    fn: () =>
      api.put(`admin/features/${feature.key}`, {
        config: Object.fromEntries((spec?.configFields ?? []).map(f => [f.key, config[f.key] ?? ''])),
        ...(Object.keys(secrets).length ? { secrets } : {})
      }),
    invalidate: [['api', 'admin/features']],
    success: `${feature.label} settings saved`,
    onSuccess: () => setSecrets({})
  })

  const test = useApiMutation({
    fn: () =>
      api.post<{ accepted: number; failures: string[] }>(
        `admin/features/${feature.key}/test`,
        testUser ? { userId: Number(testUser) } : {}
      ),
    success: r =>
      r.accepted
        ? 'Accepted by the provider'
        : `Sent — nobody subscribed${r.failures.length ? ` (${r.failures.join('; ')})` : ''}`
  })

  if (!spec || (!spec.configFields.length && !spec.secretFields.length)) return null

  return (
    <FormDialog
      trigger={
        <Button size='sm' variant='outline'>
          <SettingsIcon /> Configure
        </Button>
      }
      title={`${feature.label} — ${spec.label}`}
      description='Keys for the variant the platform set. Keys are sealed and never shown again; leave one blank to keep it.'
      submitLabel='Save'
      validate={() => ({
        ...Object.fromEntries(spec.configFields.map(f => [`c-${f.key}`, f.required && !(config[f.key] ?? '').trim() && `${f.label} is required`])),
        ...Object.fromEntries(spec.secretFields.map(f => [`s-${f.key}`, f.required && !current.secretsSet?.[f.key] && !(secrets[f.key] ?? '').trim() && `${f.label} is required`]))
      })}
      onSubmit={() => save.mutateAsync()}
    >
      {spec.configFields.map(f => (
        <TextField
          key={f.key}
          id={`c-${f.key}`}
          label={f.label}
          required={f.required}
          placeholder={f.placeholder}
          value={config[f.key] ?? ''}
          onChange={e => setConfig(c => ({ ...c, [f.key]: e.target.value }))}
        />
      ))}
      {spec.secretFields.map(f => (
        <TextField
          key={f.key}
          id={`s-${f.key}`}
          label={f.label}
          type='password'
          autoComplete='off'
          required={f.required && !current.secretsSet?.[f.key]}
          placeholder={current.secretsSet?.[f.key] ? '•••••••• stored' : 'not set'}
          value={secrets[f.key] ?? ''}
          onChange={e => setSecrets(s => ({ ...s, [f.key]: e.target.value }))}
        />
      ))}
      {spec.secretFields.length > 0 && (
        <div className='flex gap-2'>
          <input
            className='border-input bg-background h-9 flex-1 rounded-md border px-3 text-sm'
            placeholder='User id for a test (blank = segment)'
            value={testUser}
            onChange={e => setTestUser(e.target.value.replace(/\D/g, ''))}
          />
          <Button type='button' variant='outline' onClick={() => test.mutate()} disabled={test.isPending}>
            {test.isPending ? <Loader2Icon className='animate-spin' /> : <SendIcon />} Test
          </Button>
        </div>
      )}
    </FormDialog>
  )
}

const Features = () => {
  const { can, featureEntitled, actor } = useSession()
  const canWrite = can('config:write')

  // The Super Admin (and executives) switch features too; agents only read.
  const canSwitch = canWrite && actor?.direct === true
  const catalogue = useApi<Catalogue>('admin/features/catalogue')
  const featuresPoll = useLivePoll(FEATURES_POLL_MS)

  // The platform owner sets every variant, switch and the template; a short poll (plus the
  // session's entitlements watch, which refetches on a new owner version) keeps this read-only view current.
  const current = useApi<SiteFeatures>('admin/features', undefined, {
    refetchInterval: featuresPoll,
    refetchOnWindowFocus: true
  })

  const rows = useMemo(() => {
    if (!catalogue.data || !current.data) return []
    const byKey = new Map(current.data.features.map(f => [f.feature, f]))

    // This site's UI (configs/siteUi.ts): features it has no screen for are listed together, last.
    const absent = (key: string) => uiSupport(key)?.status === 'absent'

    // Owner-only policies and missing features: the site admin does not see them at all.
    const ownerOnly = (key: string) => OWNER_ONLY_FEATURES.has(key)

    // Business & payments are the owner's policies (owner panel): not shown to the site admin.
    return [...CATEGORY_ORDER.filter(c => c !== 'business'), 'not_in_ui'].map(cat => ({
      cat,
      items: catalogue
        .data!.features.filter(f => !ownerOnly(f.key) && (cat === 'not_in_ui' ? absent(f.key) : f.category === cat && !absent(f.key)))
        .flatMap(spec => {
          const cur = byKey.get(spec.key)

          if (!cur) return []

          // Left out of the plan by the owner (the row itself or the entitlements say so): not listed.
          const entitled = cur.entitled !== false && featureEntitled(spec.key)

          return entitled ? [{ spec, cur, entitled }] : []
        })
    })).filter(g => g.items.length)
  }, [catalogue.data, current.data, featureEntitled])

  const error = catalogue.error || current.error

  return (
    <div>
      <PageHeader title='Features' />

      <Alert className='mb-4'>
        <InfoIcon />
        <AlertDescription>{canSwitch ? 'Switch a feature on or off here; the platform picks the variant. The latest change, here or by the platform, is what players get.' : OWNER_MANAGED_MESSAGE}</AlertDescription>
      </Alert>

      {error && <ErrorState error={error} />}
      {!rows.length && !error && <Skeleton className='h-96' />}

      <div className='grid gap-4'>
        {rows.map(({ cat, items }) => (
          <Card key={cat} className='gap-0 py-0 shadow-none'>
            <CardHeader className='border-b py-3'>
              <CardTitle className='text-muted-foreground text-xs font-semibold tracking-wider uppercase'>
                {cat === 'not_in_ui' ? 'Not in this UI' : (CATEGORY_LABELS[cat] ?? cat)}
              </CardTitle>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className='text-muted-foreground pl-4 text-xs font-medium tracking-wide uppercase'>
                    Feature
                  </TableHead>
                  <TableHead className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
                    Variant
                  </TableHead>
                  <TableHead className='text-muted-foreground pr-4 text-xs font-medium tracking-wide uppercase'>
                    On
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(({ spec, cur, entitled }) => {
                  const policy = spec.kind === 'policy'
                  const ui = policy ? null : uiSupport(spec.key)
                  const on = policy ? cur.variant !== 'none' : cur.enabled && cur.variant !== 'none'

                  // An integration's keys, or any feature whose current variant has settings (e.g. Live TV's minimum balance and hours).
                  const hasFields = spec.category === 'integration' || Boolean(spec.variants.find(v => v.key === cur.variant)?.configFields?.length)
                  const configurable = hasFields && canWrite && entitled && cur.enabled && cur.variant !== 'none'

                  return (
                    <TableRow key={spec.key} className={entitled ? undefined : 'opacity-60'}>
                      <TableCell className='pl-4'>
                        <span className='flex items-center gap-2 font-medium'>
                          {spec.label}
                          {!entitled && (
                            <Badge variant='outline' className='gap-1 font-normal'>
                              <LockIcon className='size-3' /> Not in your plan
                            </Badge>
                          )}
                        </span>
                        <span className='text-muted-foreground block max-w-md truncate text-xs'>
                          {ui?.status === 'absent'
                            ? ui.why
                            : ui
                              ? `${UI_LABEL}: ${ui.surfaces}.`
                              : spec.variants.find(v => v.key === cur.variant)?.description}
                        </span>
                        {cur.region && cur.variant !== 'none' && (
                          <span className='text-muted-foreground block text-xs' data-region>
                            {cur.region.listType === 'allowlist' ? 'Allowed only: ' : 'Restricted: '}
                            {cur.region.countries.length ? cur.region.countries.join(', ') : 'no countries'}
                          </span>
                        )}
                        {cur.withdrawalCap && (
                          <span className='text-muted-foreground block text-xs' data-withdrawal-cap>
                            Deposit cap:{' '}
                            {cur.withdrawalCap.enabled
                              ? `${cur.withdrawalCap.depositMultiplier}× deposits${cur.withdrawalCap.wagerBonus ? ` + wagering up to ${cur.withdrawalCap.wagerMultiplier}×` : ''}, per currency`
                              : 'off'}
                          </span>
                        )}
                        {cur.withdrawalDailyLimit && (
                          <span className='text-muted-foreground block text-xs' data-withdrawal-daily-limit>
                            Daily limit:{' '}
                            {cur.withdrawalDailyLimit.enabled && Object.keys(cur.withdrawalDailyLimit.limits).length
                              ? `${Object.entries(cur.withdrawalDailyLimit.limits)
                                  .map(([c, a]) => `${c} ${Number(a).toLocaleString('en-IN', { maximumFractionDigits: 8 })}`)
                                  .join(' · ')} per 24 h`
                              : 'off'}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className='flex items-center gap-2'>
                          <Badge variant={policy ? 'secondary' : 'outline'}>
                            {ui?.status === 'absent'
                              ? 'Not in this UI'
                              : ui?.status === 'fixed'
                                ? `${UI_LABEL} · always on`
                                : ui
                                  ? UI_LABEL
                                  : variantLabel(spec, cur)}
                          </Badge>
                          {configurable && <IntegrationSettings feature={spec} current={cur} />}
                        </span>
                      </TableCell>
                      <TableCell className='pr-4'>
                        {policy ? (
                          <span className='text-muted-foreground text-xs'>always on</span>
                        ) : canSwitch && entitled && cur.variant !== 'none' && ui?.status !== 'fixed' ? (
                          <FeatureSwitch spec={spec} on={on} />
                        ) : (
                          <Badge variant={on ? 'default' : 'outline'}>{on ? 'On' : 'Off'}</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Card>
        ))}
        {actor?.direct === true && <OriginalGames canWrite={canSwitch} />}
      </div>
    </div>
  )
}

export default Features
