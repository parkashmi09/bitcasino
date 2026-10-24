import { redirect } from 'next/navigation'

// Purana link — ab Transactions → Deposit me hai.
export default function Page() {
  redirect('/transactions/deposit')
}
