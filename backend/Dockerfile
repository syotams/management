FROM node:20-alpine AS build

RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json package-lock.json* ./
COPY prisma ./prisma/
COPY scripts/prepare-mysql-schema.sh ./scripts/

RUN chmod +x scripts/prepare-mysql-schema.sh \
  && ./scripts/prepare-mysql-schema.sh prisma/schema.prisma \
  && npm ci \
  && npx prisma generate

COPY tsconfig.json ./
COPY src ./src/

RUN npm run build

FROM node:20-alpine

RUN apk add --no-cache openssl

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package.json package-lock.json* ./
COPY prisma ./prisma/
COPY scripts/prepare-mysql-schema.sh ./scripts/

RUN chmod +x scripts/prepare-mysql-schema.sh \
  && ./scripts/prepare-mysql-schema.sh prisma/schema.prisma \
  && npm ci --omit=dev \
  && npx prisma generate \
  && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000

CMD ["./docker-entrypoint.sh"]
