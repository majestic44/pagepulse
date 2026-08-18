FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @pagepulse/api... build
FROM node:24-alpine AS runtime
ENV NODE_ENV=production PORT=3000
USER node
WORKDIR /app
COPY --from=build --chown=node:node /app /app
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 CMD wget -qO- http://127.0.0.1:3000/health/live >/dev/null || exit 1
CMD ["node", "apps/api/dist/server.js"]
