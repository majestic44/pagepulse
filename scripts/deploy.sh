#!/usr/bin/env sh
set -eu

version="${1:-}"
if [ -z "$version" ]; then
  echo "Usage: scripts/deploy.sh <semantic-version>" >&2
  exit 2
fi
case "$version" in v[0-9]*.[0-9]*.[0-9]*) ;; *) echo "Version must look like v1.2.3" >&2; exit 2 ;; esac

state_dir="${PAGEPULSE_DEPLOY_STATE_DIR:-./.deploy-state}"
mkdir -p "$state_dir"
if [ -f "$state_dir/current-version" ]; then cp "$state_dir/current-version" "$state_dir/previous-version"; fi
printf '%s\n' "$version" > "$state_dir/candidate-version"

export PAGEPULSE_VERSION="${version#v}"
compose_files="-f compose.yaml -f compose.production.yaml"
docker compose $compose_files pull
docker compose $compose_files run --rm api node packages/db/dist/migrate.js
docker compose $compose_files up -d --remove-orphans

attempt=0
until docker compose $compose_files exec -T api wget -qO- http://127.0.0.1:3000/health/ready >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 12 ]; then
    echo "Readiness failed; starting rollback" >&2
    exec scripts/rollback.sh
  fi
  sleep 5
done
mv "$state_dir/candidate-version" "$state_dir/current-version"
echo "PagePulse $version is healthy"
