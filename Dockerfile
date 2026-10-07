# syntax=docker/dockerfile:1.7
# Single image: Fastify API + built web app + Chromium for server-side PDFs.
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS base
# Prisma's engines need OpenSSL.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

# ---- build: full install, compile web (Vite) and API (tsup) ----
FROM base AS build
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web
RUN npm run prisma:generate -w @laundry/api && npm run build

# ---- prod-deps: only the API's runtime dependencies ----
FROM base AS prod-deps
# @sparticuz/chromium is the Vercel/serverless Chromium (~65 MB); this image
# installs its own headless Chromium below, so drop it.
RUN npm ci --omit=dev --workspace=@laundry/api --no-audit --no-fund \
 && rm -rf node_modules/@sparticuz
COPY apps/api/prisma apps/api/prisma
RUN npm run prisma:generate -w @laundry/api

# ---- runtime ----
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    UPLOAD_DIR=/data/uploads \
    WEB_DIST=/app/apps/web/dist \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    TZ=Asia/Bahrain
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
# Headless Chromium (+ system libraries) for PDFs, and Noto fonts so Arabic and
# South-Asian customer names render correctly on invoices and statements.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates tzdata fonts-noto-core \
 && node node_modules/playwright-core/cli.js install --with-deps --only-shell chromium \
 && rm -rf /var/lib/apt/lists/* /tmp/* \
 && mkdir -p /data/uploads && chown -R node:node /data
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY apps/api/package.json ./apps/api/
COPY apps/api/prisma ./apps/api/prisma
COPY deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER node
EXPOSE 3000
VOLUME ["/data/uploads"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "apps/api/dist/index.js"]
