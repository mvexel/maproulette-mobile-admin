#!/bin/sh
# Writes the apps' config.json files (and the apple-app-site-association file) from the
# environment, then runs Caddy.
set -eu
: "${BACKEND_ORIGIN:?set BACKEND_ORIGIN, e.g. https://mr-api.osm.lol}"
CLIENT_ID="${CLIENT_ID:-maproulette-mobile-admin}"
# An origin only (scheme, host, optional port), so it is safe in JSON and in the CSP header.
echo "$BACKEND_ORIGIN" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]+)?$' ||
	{ echo "BACKEND_ORIGIN must be an origin like https://mr-api.osm.lol" >&2; exit 1; }
echo "$CLIENT_ID" | grep -Eq '^[A-Za-z0-9._-]{1,100}$' ||
	{ echo "CLIENT_ID must be 1 to 100 of A-Z a-z 0-9 . _ -" >&2; exit 1; }
printf '{"backend":"%s","clientId":"%s"}\n' "$BACKEND_ORIGIN" "$CLIENT_ID" > /srv/admin/config.json
# The claim page's config. OSM_WEB is the OpenStreetMap site the backend edits ("See your edits").
CLAIM_CLIENT_ID="${CLAIM_CLIENT_ID:-maproulette-claim}"
OSM_WEB="${OSM_WEB:-https://www.openstreetmap.org}"
echo "$CLAIM_CLIENT_ID" | grep -Eq '^[A-Za-z0-9._-]{1,100}$' ||
	{ echo "CLAIM_CLIENT_ID must be 1 to 100 of A-Z a-z 0-9 . _ -" >&2; exit 1; }
echo "$OSM_WEB" | grep -Eq '^https://[A-Za-z0-9.-]+(:[0-9]+)?$' ||
	{ echo "OSM_WEB must be an origin like https://www.openstreetmap.org" >&2; exit 1; }
printf '{"backend":"%s","clientId":"%s","mapStyle":"https://tiles.openfreemap.org/styles/positron","osmWeb":"%s"}\n' \
	"$BACKEND_ORIGIN" "$CLAIM_CLIENT_ID" "$OSM_WEB" > /srv/street/claim/config.json
# The participant site. INSTALL_URL is where "Install the beta" goes (the public TestFlight link).
INSTALL_URL="${INSTALL_URL:-}"
[ -z "$INSTALL_URL" ] || echo "$INSTALL_URL" | grep -Eq '^https://[A-Za-z0-9./_-]+$' ||
	{ echo "INSTALL_URL must be an https URL like https://testflight.apple.com/join/AbCd1234" >&2; exit 1; }
printf '{"backend":"%s","installUrl":"%s","appScheme":"mrchoice"}\n' "$BACKEND_ORIGIN" "$INSTALL_URL" > /srv/street/config.json
# Universal links: only with both IDs (a team ID like ABCDE12345, a bundle ID like lol.osm.streettally).
if [ -n "${APPLE_TEAM_ID:-}" ] && [ -n "${APPLE_BUNDLE_ID:-}" ]; then
	echo "$APPLE_TEAM_ID" | grep -Eq '^[A-Z0-9]{10}$' ||
		{ echo "APPLE_TEAM_ID must be the 10-character team ID" >&2; exit 1; }
	echo "$APPLE_BUNDLE_ID" | grep -Eq '^[A-Za-z0-9.-]{1,155}$' ||
		{ echo "APPLE_BUNDLE_ID must be a bundle ID like lol.osm.streettally" >&2; exit 1; }
	mkdir -p /srv/street/.well-known
	printf '{"applinks":{"details":[{"appIDs":["%s.%s"],"components":[{"/":"/challenge/*"}]}]}}\n' \
		"$APPLE_TEAM_ID" "$APPLE_BUNDLE_ID" > /srv/street/.well-known/apple-app-site-association
fi
export BACKEND_ORIGIN
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
