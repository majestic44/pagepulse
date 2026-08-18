# Cloudflare Baseline

- Tunnel route: application hostname → `http://gateway:8080` on the Compose edge network.
- No Cloudflare Access in front of PagePulse v1.
- Managed WAF rules enabled.
- Rate-limit login, password reset, invitation redemption and `/api/v1` routes.
- Bypass cache for `/api/*`, authenticated HTML and service worker update responses.
- Preserve WebSocket/Web Push-compatible behavior where required.
- Origin has no public listener; remove direct Plesk proxy/domain exposure.
- Validate CSP and other gateway headers in CI and after deployment.
