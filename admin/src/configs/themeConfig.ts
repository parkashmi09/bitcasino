import { siteConfig } from './site'

const themeConfig = {
  templateName: siteConfig.name,
  homePageUrl: '/dashboard'
} as const

export default themeConfig
