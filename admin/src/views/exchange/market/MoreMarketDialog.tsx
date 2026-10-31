'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export type MoreMarketRow = { mid: string; mname: string; book: number }

type Props = {
  open: boolean
  rows: MoreMarketRow[]
  onClose: () => void
  onPick: (row: MoreMarketRow) => void
}

/**
 * MORE MARKET — zip ka `components/game-details/MoreMarketModal.jsx` (cricket ke alawa har
 * sport pe). Market Name pe click = page wahi market dikhata hai. Market Book = us market pe
 * downline ki open bets.
 */
const MoreMarketDialog = ({ open, rows, onClose, onPick }: Props) => (
  <Dialog open={open} onOpenChange={o => !o && onClose()}>
    <DialogContent className='sm:max-w-lg'>
      <DialogHeader>
        <DialogTitle>MORE MARKET</DialogTitle>
      </DialogHeader>
      <div className='max-h-[60vh] overflow-auto rounded-md border'>
        <table className='w-full text-sm'>
          <thead>
            <tr className='bg-muted'>
              <th className='px-3 py-2 text-left'>Market Name</th>
              <th className='px-3 py-2 text-right'>Market Book</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map(row => (
                <tr key={row.mid} className='border-t'>
                  <td className='px-3 py-1.5'>
                    <button type='button' className='text-primary hover:underline' onClick={() => onPick(row)}>
                      {row.mname}
                    </button>
                  </td>
                  <td className='px-3 py-1.5 text-right tabular-nums'>{row.book}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={2} className='px-3 py-2'>
                  No record found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </DialogContent>
  </Dialog>
)

export default MoreMarketDialog
