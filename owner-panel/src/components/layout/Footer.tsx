import { siteConfig } from '@/configs/site'

const Footer = () => {
  return (
    <footer>
      <div className='text-muted-foreground mx-auto flex size-full max-w-360 items-center justify-between gap-3 px-4 py-3 text-sm max-sm:flex-col sm:gap-6 sm:px-6'>
        <p>
          ©{new Date().getFullYear()} {siteConfig.name} · site-admin
        </p>
        <p className='font-mono text-xs'>
          {siteConfig.key} · {siteConfig.environment}
        </p>
      </div>
    </footer>
  )
}

export default Footer
