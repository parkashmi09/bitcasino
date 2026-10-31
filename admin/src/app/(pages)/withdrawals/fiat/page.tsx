import { redirect } from 'next/navigation'

// Purana link — ab Transactions → Withdraw me hai.
export default function Page() {
  redirect('/transactions/withdraw')
}
