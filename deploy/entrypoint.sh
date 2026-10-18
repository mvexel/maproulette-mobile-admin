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
# Optional: dev, stage or prod for the header badge. Without it the app infers it from the host.
ADMIN_ENVIRONMENT="${ADMIN_ENVIRONMENT:-}"
case "$ADMIN_ENVIRONMENT" in
	"") ENV_JSON="" ;;
	dev|stage|prod) ENV_JSON=",\"environment\":\"$ADMIN_ENVIRONMENT\"" ;;
	*) echo "ADMIN_ENVIRONMENT must be dev, stage or prod" >&2; exit 1 ;;
esac
# OSM_WEB is the OpenStreetMap site the backend signs in with and edits ("See your edits", and
# the admin's "Sign out of OpenStreetMap" link).
# Unset, the admin infers it from the environment (dev: the OSM dev server) and the claim page
# uses openstreetmap.org.
OSM_JSON=""
if [ -n "${OSM_WEB:-}" ]; then
	echo "$OSM_WEB" | grep -Eq '^https://[A-Za-z0-9.-]+(:[0-9]+)?$' ||
		{ echo "OSM_WEB must be an origin like https://www.openstreetmap.org" >&2; exit 1; }
	OSM_JSON=",\"osmWeb\":\"$OSM_WEB\""
fi
OSM_WEB="${OSM_WEB:-https://www.openstreetmap.org}"
printf '{"backend":"%s","clientId":"%s"%s%s}\n' "$BACKEND_ORIGIN" "$CLIENT_ID" "$OSM_JSON" "$ENV_JSON" > /srv/admin/config.json
# The claim page's config.
CLAIM_CLIENT_ID="${CLAIM_CLIENT_ID:-maproulette-claim}"
echo "$CLAIM_CLIENT_ID" | grep -Eq '^[A-Za-z0-9._-]{1,100}$' ||
	{ echo "CLAIM_CLIENT_ID must be 1 to 100 of A-Z a-z 0-9 . _ -" >&2; exit 1; }
# The review page's client (handback-copy §2): tasks:read only, no OSM scope.
REVIEW_CLIENT_ID="${REVIEW_CLIENT_ID:-street-tally-review}"
echo "$REVIEW_CLIENT_ID" | grep -Eq '^[A-Za-z0-9._-]{1,100}$' ||
	{ echo "REVIEW_CLIENT_ID must be 1 to 100 of A-Z a-z 0-9 . _ -" >&2; exit 1; }
printf '{"backend":"%s","clientId":"%s","mapStyle":"https://tiles.openfreemap.org/styles/positron","osmWeb":"%s","reviewClientId":"%s"}\n' \
	"$BACKEND_ORIGIN" "$CLAIM_CLIENT_ID" "$OSM_WEB" "$REVIEW_CLIENT_ID" > /srv/street/claim/config.json
# The participant site. INSTALL_URL is where "Install the beta" goes (the public TestFlight link).
INSTALL_URL="${INSTALL_URL:-}"
[ -z "$INSTALL_URL" ] || echo "$INSTALL_URL" | grep -Eq '^https://[A-Za-z0-9./_-]+$' ||
	{ echo "INSTALL_URL must be an https URL like https://testflight.apple.com/join/AbCd1234" >&2; exit 1; }
# Android: direct signed APK URL plus the exact participant-facing version label.
ANDROID_INSTALL_URL="${ANDROID_INSTALL_URL:-}"
ANDROID_VERSION="${ANDROID_VERSION:-}"
# grep checks one line at a time: reject line breaks before interpolating either field into JSON.
[ "$ANDROID_INSTALL_URL" = "$(printf '%s' "$ANDROID_INSTALL_URL" | tr -d '\r\n')" ] &&
[ "$ANDROID_VERSION" = "$(printf '%s' "$ANDROID_VERSION" | tr -d '\r\n')" ] ||
	{ echo "Android download fields must not contain line breaks" >&2; exit 1; }
[ -z "$ANDROID_INSTALL_URL" ] || echo "$ANDROID_INSTALL_URL" | grep -Eq '^https://[A-Za-z0-9./_-]+$' ||
	{ echo "ANDROID_INSTALL_URL must be an https URL" >&2; exit 1; }
[ -z "$ANDROID_VERSION" ] || echo "$ANDROID_VERSION" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._+ -]{0,79}$' ||
	{ echo "ANDROID_VERSION must be a version label of at most 80 safe characters" >&2; exit 1; }
printf '{"backend":"%s","installUrl":"%s","appScheme":"mrchoice","androidInstallUrl":"%s","androidVersion":"%s"}\n' "$BACKEND_ORIGIN" "$INSTALL_URL" "$ANDROID_INSTALL_URL" "$ANDROID_VERSION" > /srv/street/config.json
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
# Android App Links: only with both values (a package like lol.osm.maproulette.choice and the release
# key's SHA-256 as 32 colon-separated hex pairs).
if [ -n "${ANDROID_PACKAGE:-}" ] && [ -n "${ANDROID_CERT_SHA256:-}" ]; then
	echo "$ANDROID_PACKAGE" | grep -Eq '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$' ||
		{ echo "ANDROID_PACKAGE must be a package name like lol.osm.maproulette.choice" >&2; exit 1; }
	echo "$ANDROID_CERT_SHA256" | grep -Eq '^[0-9A-F]{2}(:[0-9A-F]{2}){31}$' ||
		{ echo "ANDROID_CERT_SHA256 must be the SHA-256 fingerprint as AA:BB:... in upper case" >&2; exit 1; }
	mkdir -p /srv/street/.well-known
	printf '[{"relation":["delegate_permission/common.handle_all_urls"],"target":{"namespace":"android_app","package_name":"%s","sha256_cert_fingerprints":["%s"]}}]\n' \
		"$ANDROID_PACKAGE" "$ANDROID_CERT_SHA256" > /srv/street/.well-known/assetlinks.json
fi
export BACKEND_ORIGIN
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
