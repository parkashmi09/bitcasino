import { redirect } from 'next/navigation'

// Purana link: Direct User Wallet ab Main → Wallets (`/wallets`) pe hai.
export default function Page() {
  redirect('/wallets')
}
