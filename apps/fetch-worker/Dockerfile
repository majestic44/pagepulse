FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @pagepulse/fetch-worker... build
FROM node:24-alpine
ENV NODE_ENV=production
USER node
WORKDIR /app
COPY --from=build --chown=node:node /app /app
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 CMD node packages/queue/dist/healthcheck.js apps/fetch-worker/dist/index.js
CMD ["node", "apps/fetch-worker/dist/index.js"]
