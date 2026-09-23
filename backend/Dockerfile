# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
RUN apk add --no-cache openssl
WORKDIR /app

# Install all deps once; cached unless package-lock changes.
FROM base AS deps
COPY package.json package-lock.json* ./
# Avoid @prisma/client postinstall generate (no schema in this layer yet).
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=true
RUN --mount=type=cache,target=/root/.npm \
  npm ci

FROM deps AS build
COPY prisma ./prisma/
COPY scripts ./scripts/
RUN chmod +x scripts/prepare-mysql-schema.sh \
  && ./scripts/prepare-mysql-schema.sh prisma/schema.prisma \
  && npx prisma generate
COPY tsconfig.json ./
COPY src ./src/
RUN npm run build

# Production: reuse installed modules, drop devDependencies, then generate client.
FROM base AS production
ENV NODE_ENV=production
ENV PORT=3000
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=true

COPY package.json package-lock.json* ./
COPY --from=deps /app/node_modules ./node_modules
RUN npm prune --omit=dev \
  && npm cache clean --force

COPY prisma ./prisma/
COPY scripts ./scripts/
RUN chmod +x scripts/prepare-mysql-schema.sh \
  && ./scripts/prepare-mysql-schema.sh prisma/schema.prisma \
  && npx prisma generate

COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000

CMD ["./docker-entrypoint.sh"]
