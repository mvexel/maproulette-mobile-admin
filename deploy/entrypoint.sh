#!/bin/sh
# Writes /srv/config.json from the environment, then runs Caddy.
set -eu
: "${BACKEND_ORIGIN:?set BACKEND_ORIGIN, e.g. https://mr-api.osm.lol}"
CLIENT_ID="${CLIENT_ID:-maproulette-mobile-admin}"
# An origin only (scheme, host, optional port), so it is safe in JSON and in the CSP header.
echo "$BACKEND_ORIGIN" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]+)?$' ||
	{ echo "BACKEND_ORIGIN must be an origin like https://mr-api.osm.lol" >&2; exit 1; }
echo "$CLIENT_ID" | grep -Eq '^[A-Za-z0-9._-]{1,100}$' ||
	{ echo "CLIENT_ID must be 1 to 100 of A-Z a-z 0-9 . _ -" >&2; exit 1; }
# Optional: dev, stage or prod for the header badge. Without it the app infers it from the host.
ADMIN_ENVIRONMENT="${ADMIN_ENVIRONMENT:-}"
case "$ADMIN_ENVIRONMENT" in
	"") ENV_JSON="" ;;
	dev|stage|prod) ENV_JSON=",\"environment\":\"$ADMIN_ENVIRONMENT\"" ;;
	*) echo "ADMIN_ENVIRONMENT must be dev, stage or prod" >&2; exit 1 ;;
esac
printf '{"backend":"%s","clientId":"%s"%s}\n' "$BACKEND_ORIGIN" "$CLIENT_ID" "$ENV_JSON" > /srv/config.json
# The claim page's config. OSM_WEB is the OpenStreetMap site the backend edits ("See your edits").
CLAIM_CLIENT_ID="${CLAIM_CLIENT_ID:-maproulette-claim}"
OSM_WEB="${OSM_WEB:-https://www.openstreetmap.org}"
echo "$CLAIM_CLIENT_ID" | grep -Eq '^[A-Za-z0-9._-]{1,100}$' ||
	{ echo "CLAIM_CLIENT_ID must be 1 to 100 of A-Z a-z 0-9 . _ -" >&2; exit 1; }
echo "$OSM_WEB" | grep -Eq '^https://[A-Za-z0-9.-]+(:[0-9]+)?$' ||
	{ echo "OSM_WEB must be an origin like https://www.openstreetmap.org" >&2; exit 1; }
printf '{"backend":"%s","clientId":"%s","mapStyle":"https://tiles.openfreemap.org/styles/positron","osmWeb":"%s"}\n' \
	"$BACKEND_ORIGIN" "$CLAIM_CLIENT_ID" "$OSM_WEB" > /srv/claim/config.json
export BACKEND_ORIGIN
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
