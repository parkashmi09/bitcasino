import { serverConfig } from '@/configs/site'
import SystemTracker from '@/views/system-tracker/SystemTracker'

export const metadata = { title: 'System Tracker' }

export default function Page() {
  // Watchdog ke "Open ... Settlement" buttons site admin kholte hain
  return <SystemTracker adminUrl={serverConfig.adminUrl} />
}
