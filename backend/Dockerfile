# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
RUN apk add --no-cache openssl
WORKDIR /app

# Faster, quieter installs; skip Prisma generate during npm (we run it explicitly).
ENV NPM_CONFIG_UPDATE=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_UPDATE=false \
    NPM_CONFIG_PREFER_OFFLINE=true \
    NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_MAXSOCKETS=50 \
    PRISMA_SKIP_POSTINSTALL_GENERATE=true

# Production lockfile install only — no jest/typescript/test tooling (~half the download).
FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
  npm ci --omit=dev

# Compile TypeScript; install compiler tools outside package.json so --omit=dev
# does not skip them, and jest/test tooling is never pulled in.
FROM deps AS build
RUN --mount=type=cache,target=/root/.npm \
  npm install --prefix /tmp/build-tools --ignore-scripts \
    typescript@5.9.2 \
    @types/node@24.3.0 \
    @types/express@5.0.3 \
    @types/bcryptjs@2.4.6 \
    @types/passport-jwt@4.0.1 \
  && cp -a /tmp/build-tools/node_modules/. /app/node_modules/

COPY prisma ./prisma/
COPY scripts ./scripts/
RUN chmod +x scripts/prepare-mysql-schema.sh \
  && ./scripts/prepare-mysql-schema.sh prisma/schema.prisma \
  && npx prisma generate

COPY tsconfig.json ./
COPY src ./src/
RUN ./node_modules/.bin/tsc

FROM base AS production
ENV NODE_ENV=production
ENV PORT=3000

COPY package.json package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules
# Generated client (and MySQL-adapted schema) from build — no second npm ci / generate.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/dist ./dist
COPY scripts/migrate-epic-assignments.js ./scripts/
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000

CMD ["./docker-entrypoint.sh"]
