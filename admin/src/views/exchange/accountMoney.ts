import { api } from '@/lib/api/client'
import type { AccountRow } from './types'

/** Zip jaisa number: 1,234.5 */
export const fmt = (value: string | number) => Number(value || 0).toLocaleString()

/** Paisa / points badalne ke baad ye queries bhi refresh hon. */
export const SETTLE_INVALIDATE = [['api', 'admin/exchange/accounts'], ['api', 'admin/exchange/dashboard'], ['api', 'admin/exchange/user-reports/home'], ['api', 'admin/exchange/owner/wallet']]

/** Zip ka settle API (Bank page): points + = parent deta hai (D), − = parent leta hai (W). */
export const settleApi = (row: AccountRow, points: number, transactionPassword: string, remark?: string) =>
  api.post('admin/exchange/points/settle', {
    accountType: row.accountType,
    accountId: Number(row.accountId),
    points,
    ...(remark ? { remark } : {}),
    ...(transactionPassword ? { transactionPassword } : {})
  })
