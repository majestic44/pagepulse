FROM mcr.microsoft.com/playwright:v1.57.0-noble AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @pagepulse/browser-worker... build
FROM mcr.microsoft.com/playwright:v1.57.0-noble
ENV NODE_ENV=production
RUN useradd --create-home --uid 10001 pagepulse
USER pagepulse
WORKDIR /app
COPY --from=build --chown=pagepulse:pagepulse /app /app
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 CMD node -e "process.kill(1, 0)"
CMD ["node", "apps/browser-worker/dist/index.js"]
