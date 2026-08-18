FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @pagepulse/devtools... build
FROM node:24-alpine
ENV NODE_ENV=production PORT=4010
USER node
WORKDIR /app
COPY --from=build --chown=node:node /app /app
EXPOSE 4010
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 CMD wget -qO- http://127.0.0.1:4010/targets/jobs >/dev/null || exit 1
CMD ["node", "apps/devtools/dist/index.js"]
