# Multi-stage Air-Gapped On-Premise Build for Hypotheca (KVKK / GDPR Zero-Egress)
# Build from repository root:
#   docker build -f src/modules/privacy-runtime/onprem/Dockerfile -t hypotheca-onprem:latest .

FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime

RUN rm -f /etc/nginx/conf.d/default.conf \
  && sed -i 's|/run/nginx.pid|/tmp/nginx.pid|g' /etc/nginx/nginx.conf \
  && sed -i '/^user /d' /etc/nginx/nginx.conf \
  && mkdir -p /var/cache/nginx /tmp \
  && chown -R nginx:nginx /var/cache/nginx /tmp /usr/share/nginx/html

COPY src/modules/privacy-runtime/onprem/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

USER nginx
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
