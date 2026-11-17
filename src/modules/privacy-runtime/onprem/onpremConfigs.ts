export const ONPREM_DOCKERFILE = `# Multi-stage Air-Gapped On-Premise Build for Hypotheca (KVKK / GDPR Zero-Egress)
# Build from repository root:
#   docker build -f src/modules/privacy-runtime/onprem/Dockerfile -t hypotheca-onprem:latest .

FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime

RUN rm -f /etc/nginx/conf.d/default.conf \\
  && sed -i 's|/run/nginx.pid|/tmp/nginx.pid|g' /etc/nginx/nginx.conf \\
  && sed -i '/^user /d' /etc/nginx/nginx.conf \\
  && mkdir -p /var/cache/nginx /tmp \\
  && chown -R nginx:nginx /var/cache/nginx /tmp /usr/share/nginx/html

COPY src/modules/privacy-runtime/onprem/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

USER nginx
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]`;

export const ONPREM_NGINX_CONF = `# Hardened Institutional / Hospital / University Air-Gapped Nginx Configuration
# Zero external telemetry, strict Content-Security-Policy blocking outbound egress.

server {
    listen 8080;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    server_tokens off;
    access_log off;

    # Strict Zero-Egress Security Headers (KVKK / GDPR)
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self';" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header Permissions-Policy "geolocation=(), microphone=(), camera=(), interest-cohort=()" always;
    add_header Cross-Origin-Opener-Policy "same-origin" always;

    location = /healthz {
        default_type text/plain;
        return 200 "ok\\n";
    }

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable" always;
        add_header Content-Security-Policy "default-src 'self'; connect-src 'self';" always;
        try_files $uri =404;
    }

    location / {
        add_header Cache-Control "no-store" always;
        add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self';" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "DENY" always;
        add_header Referrer-Policy "no-referrer" always;
        try_files $uri $uri/ /index.html;
    }
}`;

export const ONPREM_COMPOSE_YML = `# Institutional Air-Gapped On-Premise Deployment for Hypotheca
# Usage from repository root:
#   docker compose -f src/modules/privacy-runtime/onprem/docker-compose.yml up -d --build

services:
  hypotheca-onprem:
    build:
      context: ../../../..
      dockerfile: src/modules/privacy-runtime/onprem/Dockerfile
    image: hypotheca-onprem:latest
    container_name: hypotheca-onprem
    restart: unless-stopped
    ports:
      - "8080:8080"
    read_only: true
    tmpfs:
      - /var/cache/nginx:mode=1777
      - /tmp:mode=1777
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    environment:
      - HYPOTHECA_MODE=airgapped-onprem
      - HYPOTHECA_TELEMETRY=disabled
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:8080/healthz"]
      interval: 30s
      timeout: 3s
      retries: 3
    networks:
      - institutional_lan

networks:
  institutional_lan:
    driver: bridge
    internal: true`;
