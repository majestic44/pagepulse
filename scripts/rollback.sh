#!/usr/bin/env sh
set -eu
state_dir="${PAGEPULSE_DEPLOY_STATE_DIR:-./.deploy-state}"
previous_file="$state_dir/previous-version"
if [ ! -f "$previous_file" ]; then echo "No previous version recorded; manual recovery required" >&2; exit 1; fi
previous="$(sed -n '1p' "$previous_file")"
case "$previous" in v[0-9]*.[0-9]*.[0-9]*) ;; *) echo "Invalid recorded version" >&2; exit 1 ;; esac
export PAGEPULSE_VERSION="${previous#v}"
docker compose -f compose.yaml -f compose.production.yaml pull
docker compose -f compose.yaml -f compose.production.yaml up -d --remove-orphans
printf '%s\n' "$previous" > "$state_dir/current-version"
echo "Rolled back application images to $previous; verify readiness and schema compatibility"
