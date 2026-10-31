import { notFound } from 'next/navigation'

// Any URL no screen matches renders (pages)/not-found.tsx inside the sidebar and header.
const Missing = () => notFound()

export default Missing
