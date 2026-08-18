# Infisical Infrastructure Boundary

Deploy self-hosted Infisical as a separate Compose project using its official pinned release instructions. Do not copy its upstream Compose file into PagePulse because that would hide security and migration updates.

Requirements:

- Independent project directory, network, PostgreSQL, Redis and volumes.
- Cloudflare Tunnel hostname distinct from PagePulse and restricted administration access.
- Plesk backup coverage for Infisical data, configuration and recovery material.
- Break-glass recovery procedure stored outside both VPS and GitHub.
- PagePulse machine identity with access only to the PagePulse production environment.
- Host-side CLI injection for Plesk deployment; application containers do not receive broad Infisical credentials.

Official guide: https://infisical.com/docs/self-hosting/deployment-options/docker-compose

The 4 CPU/8 GB colocated host is a constrained baseline. Move Infisical to another host or upgrade when memory pressure, swap, browser queue lag or backup contention crosses `docs/DEPLOYMENT.md` thresholds.
