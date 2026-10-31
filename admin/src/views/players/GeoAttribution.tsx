/**
 * Where the login locations come from — the provider chain in
 * `backend/services/user/src/modules/auth/geo/ipLocation.js`: ipinfo.io, then ipwho.is, then the
 * offline DB-IP Lite file (CC BY 4.0, which is why DB-IP stays credited).
 */
const A = ({ href, children }: { href: string; children: string }) => (
  <a href={href} target='_blank' rel='noreferrer' className='underline'>
    {children}
  </a>
)

const GeoAttribution = ({ className }: { className?: string }) => (
  <p className={className ?? 'text-muted-foreground text-xs'}>
    IP geolocation by <A href='https://ipinfo.io'>ipinfo.io</A> and <A href='https://ipwho.is'>ipwho.is</A>, with{' '}
    <A href='https://db-ip.com'>DB-IP</A> as the offline fallback.
  </p>
)

export default GeoAttribution
