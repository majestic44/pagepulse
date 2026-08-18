# Plesk Integration

1. Configure Plesk Git integration for the deployment checkout.
2. Authenticate the host to GHCR with a least-privilege package-read credential supplied outside the repository.
3. Install/configure the Infisical CLI and PagePulse machine identity.
4. Configure Plesk’s post-deployment action to call the release-specific deployment wrapper, not to build images from source.
5. Configure seven daily backup generations for MariaDB, Redis, PagePulse deployment state and the entire Infisical project.
6. Do not expose application or data-service ports publicly. Cloudflare Tunnel is the sole production ingress.

Never put credentials in the Plesk Git deployment command, repository URL, shell history or checked-in environment file.
