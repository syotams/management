FROM node:20-alpine AS build

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

FROM nginx:alpine

RUN apk add --no-cache openssl

COPY deploy/nginx/nginx.conf /etc/nginx/templates/default.conf.template
COPY deploy/nginx/app-locations.conf /etc/nginx/app-locations.conf
COPY deploy/nginx/http-mode.conf /etc/nginx/http-mode.conf
COPY deploy/nginx/ssl-headers.conf /etc/nginx/ssl-headers.conf
COPY deploy/nginx/prepare-ssl.sh /usr/local/bin/prepare-ssl.sh
COPY deploy/nginx/reload-ssl.sh /docker-entrypoint.d/19-reload-ssl.sh

RUN chmod +x /usr/local/bin/prepare-ssl.sh /docker-entrypoint.d/19-reload-ssl.sh \
  && ln -s /usr/local/bin/prepare-ssl.sh /docker-entrypoint.d/18-prepare-ssl.sh \
  && mkdir -p /var/www/certbot /etc/nginx/ssl

COPY --from=build /app/dist/frontend/browser /usr/share/nginx/html

EXPOSE 80 443

CMD ["nginx", "-g", "daemon off;"]
