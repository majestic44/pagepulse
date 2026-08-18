#!/usr/bin/env sh
set -eu
if ! command -v infisical >/dev/null 2>&1; then echo "Infisical CLI is required on the deployment host" >&2; exit 1; fi
exec infisical run --projectId="${INFISICAL_PROJECT_ID:?required}" --env="${INFISICAL_ENVIRONMENT:-prod}" -- docker compose -f compose.yaml -f compose.production.yaml "$@"
