'use client'

import { useState, type FormEvent } from 'react'

import { toast } from 'sonner'

import ChannelTabs, { type Channel } from '@/components/shared/ChannelTabs'
import PageHeader from '@/components/shared/PageHeader'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { DatePicker } from '@/components/ui/date-picker'
import { api, errorMessage } from '@/lib/api/client'
import { exportExcel, exportPdf } from '../exportList'
import {
  ActionButtons,
  ClientSearch,
  clientBody,
  defaultRange,
  FilterField,
  GAME_TYPES,
  Pick,
  ReportCard,
  ReportTable,
  SPORTS_LIST,
  withMinimumDelay,
  type Client,
  type ReportColumn,
  rangeError
} from './reportKit'

type TurnoverResult = { loss_turnover: number; loss: number; win_turnover: number; win: number; total_turnover: number; total_pl: number }

const EXPORT_COLS = ['Loss Turn Over', 'Loss', 'Win Turn Over', 'Win', 'Total Turn Over', 'Total P/L']

// Zip me Type = Sports / Casino tha — yahan sirf Sports (casino exchange nahi hai).
const TYPE_OPTIONS: [string, string][] = [['', 'Select Type'], ['1', 'Sports']]

const valuesOf = (r: TurnoverResult) => [r.loss_turnover, r.loss, r.win_turnover, r.win, r.total_turnover, r.total_pl]

/**
 * Turnover Report — zip ka `reports/Turnover.jsx` (`POST /admin/reports/turnover`).
 *
 * Range + sport (+ game type) ki bets: jeeti / haari bets ki liability (Turn Over)
 * aur ledger ka Win / Loss. Type aur Sports List zaroori (laal outline).
 */
const TurnoverReport = ({ channel }: { channel: Channel }) => {
  const initial = defaultRange()
  const [client, setClient] = useState<Client | null>(null)
  const [fromDate, setFromDate] = useState(initial.from)
  const [toDate, setToDate] = useState(initial.to)
  const [typeVal, setTypeVal] = useState('')
  const [sportVal, setSportVal] = useState('')
  const [gameTypeVal, setGameTypeVal] = useState('')
  const [typeInvalid, setTypeInvalid] = useState(false)
  const [sportInvalid, setSportInvalid] = useState(false)
  const [rows, setRows] = useState<TurnoverResult[]>([])
  const [loading, setLoading] = useState(false)

  const handleLoad = async (e: FormEvent) => {
    e.preventDefault()
    setTypeInvalid(!typeVal)
    setSportInvalid(Boolean(typeVal) && !sportVal)

    if (!typeVal || !sportVal) {
      toast.error(!typeVal ? 'Choose a type' : 'Choose a sport')

      return
    }

    const badRange = rangeError({ from: fromDate, to: toDate })

    if (badRange) {
      toast.error(badRange)

      return
    }

    setLoading(true)

    try {
      const res = await withMinimumDelay(
        api.post<TurnoverResult>('admin/exchange/reports/turnover', {
          ...clientBody(client), channel,
          fromDate,
          toDate,
          sportId: sportVal,
          gtype: gameTypeVal || undefined
        })
      )

      setRows([res])
    } catch (err) {
      toast.error(errorMessage(err))
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    const range = defaultRange()

    setClient(null)
    setFromDate(range.from)
    setToDate(range.to)
    setTypeVal('')
    setSportVal('')
    setGameTypeVal('')
    setTypeInvalid(false)
    setSportInvalid(false)
    setLoading(true)
    setTimeout(() => {
      setRows([])
      setLoading(false)
    }, 1000)
  }

  const columns: ReportColumn<TurnoverResult>[] = EXPORT_COLS.map((header, i) => ({
    key: header,
    header,
    align: 'right',
    cell: r => String(valuesOf(r)[i] ?? '-')
  }))

  return (
    <div>

      <ReportCard>
        <div className='space-y-4 border-b p-4'>
          <Alert>
            <AlertDescription>You will be able to see the data of last 7 days only.</AlertDescription>
          </Alert>

          <form onSubmit={handleLoad} className='space-y-4'>
            <div className='grid gap-4 md:grid-cols-3 lg:grid-cols-6'>
              <FilterField label='Search By Client Name'>
                <ClientSearch value={client} onChange={setClient} channel={channel} />
              </FilterField>
              <FilterField label='From Date:'>
                <DatePicker value={fromDate} onChange={setFromDate} max={initial.to} clearable={false} />
              </FilterField>
              <FilterField label='To Date:'>
                <DatePicker value={toDate} onChange={setToDate} max={initial.to} clearable={false} />
              </FilterField>
              <FilterField label='Type'>
                <Pick
                  value={typeVal}
                  invalid={typeInvalid}
                  onChange={v => {
                    setTypeVal(v)
                    setTypeInvalid(!v)
                    setSportVal('')
                    setGameTypeVal('')
                    setSportInvalid(false)
                  }}
                  options={TYPE_OPTIONS}
                />
              </FilterField>
              {typeVal === '1' && (
                <>
                  <FilterField label='Sports List'>
                    <Pick
                      value={sportVal}
                      invalid={sportInvalid}
                      onChange={v => {
                        setSportVal(v)
                        setSportInvalid(!v)
                      }}
                      options={[['', 'Select Sports List'], ...SPORTS_LIST]}
                    />
                  </FilterField>
                  <FilterField label='Game Type'>
                    <Pick value={gameTypeVal} onChange={setGameTypeVal} options={[['', 'Select Game Type'], ...GAME_TYPES]} />
                  </FilterField>
                </>
              )}
            </div>
            <ActionButtons
              busy={loading}
              onReset={handleReset}
              canExport={rows.length > 0}
              onExcel={() => exportExcel('turnover', EXPORT_COLS, rows.map(valuesOf))}
              onPdf={() => exportPdf('turnover', 'Turnover Report', EXPORT_COLS, rows.map(valuesOf))}
            />
          </form>
        </div>

        <ReportTable columns={columns} rows={rows} rowKey={(_, i) => String(i)} />
      </ReportCard>
    </div>
  )
}

/** Upar Direct Users | Agent Users tab — dono ka report alag (API ko `channel`). */
const Turnover = () => (
  <div>
    <PageHeader title='Turnover Report' />
    <ChannelTabs>{channel => <TurnoverReport channel={channel} />}</ChannelTabs>
  </div>
)

export default Turnover
