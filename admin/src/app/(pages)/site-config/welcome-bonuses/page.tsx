import { redirect } from 'next/navigation'

// Welcome bonuses now live on the Bonus page's Welcome bonuses tab; old links land there.
export default function Page() {
  redirect('/bonus')
}
