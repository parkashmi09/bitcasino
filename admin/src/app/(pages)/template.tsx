import type { ReactNode } from 'react'

// Re-mounts on every navigation, so each page fades in as Luno's body does (off under reduced motion).
const PagesTemplate = ({ children }: { children: ReactNode }) => <div className='animate-page-in'>{children}</div>

export default PagesTemplate
