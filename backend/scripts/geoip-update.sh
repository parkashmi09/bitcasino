#!/usr/bin/env bash
# Fetch this month's DB-IP Lite databases (free, CC BY 4.0: "IP Geolocation by DB-IP")
# into data/geoip, falling back to last month's if this month's isn't out yet.
# The user service reloads the files on change. Run monthly (cron or by hand).
set -euo pipefail
dir="${GEOIP_DIR:-$(cd "$(dirname "$0")/.." && pwd)/data/geoip}"
mkdir -p "$dir"
for f in dbip-city-lite dbip-asn-lite; do
  ok=""
  for m in "$(date -u +%Y-%m)" "$(date -u -v-1m +%Y-%m 2>/dev/null || date -u -d '1 month ago' +%Y-%m)"; do
    if curl -sfL --max-time 600 -o "$dir/$f.mmdb.gz.tmp" "https://download.db-ip.com/free/$f-$m.mmdb.gz"; then
      gunzip -c "$dir/$f.mmdb.gz.tmp" > "$dir/$f.mmdb.tmp" && mv "$dir/$f.mmdb.tmp" "$dir/$f.mmdb"
      rm -f "$dir/$f.mmdb.gz.tmp"; echo "$f: $m"; ok=1; break
    fi
  done
  [ -n "$ok" ] || { echo "$f: download failed" >&2; exit 1; }
done
