import { siteConfig } from './site'

const themeConfig = {
  templateName: siteConfig.name,
  homePageUrl: '/overview'
} as const

export default themeConfig
