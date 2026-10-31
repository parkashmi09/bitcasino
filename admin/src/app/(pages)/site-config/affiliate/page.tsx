import { redirect } from 'next/navigation'

// Affiliate rates now live on the Affiliate page's Rates tab; old links land there.
export default function Page() {
  redirect('/affiliate')
}
