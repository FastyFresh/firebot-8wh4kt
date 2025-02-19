# Build stage
FROM node:18-alpine AS builder
LABEL maintainer="AI Trading Bot Team" \
      version="1.0.0" \
      description="Trading dashboard frontend container with security hardening and performance optimizations"

# Set working directory
WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Copy package files
COPY package*.json ./

# Install dependencies with clean npm cache and production only
RUN npm ci --production && \
    npm cache clean --force

# Copy source code
COPY . .

# Build production bundle
RUN npm run build

# Production stage
FROM nginx:1.25-alpine
LABEL maintainer="AI Trading Bot Team" \
      version="1.0.0" \
      description="Trading dashboard frontend container with security hardening and performance optimizations"

# Create nginx user and group
RUN addgroup -g 101 -S nginx && \
    adduser -S -D -H -u 101 -h /var/cache/nginx -s /sbin/nologin -G nginx nginx

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Nginx configuration
RUN mkdir -p /etc/nginx/conf.d && \
    chown -R nginx:nginx /etc/nginx/conf.d && \
    chown -R nginx:nginx /var/cache/nginx && \
    chown -R nginx:nginx /var/log/nginx && \
    chown -R nginx:nginx /etc/nginx/conf.d && \
    chown -R nginx:nginx /usr/share/nginx/html && \
    chmod -R 755 /usr/share/nginx/html && \
    touch /var/run/nginx.pid && \
    chown -R nginx:nginx /var/run/nginx.pid

# Custom nginx configuration
RUN echo 'server { \
    listen 80; \
    server_name _; \
    root /usr/share/nginx/html; \
    index index.html; \
    \
    # Security headers \
    add_header X-Frame-Options "DENY" always; \
    add_header X-Content-Type-Options "nosniff" always; \
    add_header X-XSS-Protection "1; mode=block" always; \
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always; \
    add_header Content-Security-Policy "default-src '\''self'\''; script-src '\''self'\'' '\''unsafe-inline'\'' '\''unsafe-eval'\''; style-src '\''self'\'' '\''unsafe-inline'\'';" always; \
    \
    # Gzip configuration \
    gzip on; \
    gzip_vary on; \
    gzip_min_length 10240; \
    gzip_proxied expired no-cache no-store private auth; \
    gzip_types text/plain text/css text/xml text/javascript application/x-javascript application/xml application/javascript; \
    gzip_disable "MSIE [1-6]\."; \
    \
    # Browser caching \
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ { \
        expires 30d; \
        add_header Cache-Control "public, no-transform"; \
    } \
    \
    # SPA routing \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
    \
    # Rate limiting \
    limit_req_zone $binary_remote_addr zone=one:10m rate=30r/s; \
    limit_req zone=one burst=10 nodelay; \
    \
    # Error pages \
    error_page 404 /index.html; \
    error_page 500 502 503 504 /50x.html; \
    location = /50x.html { \
        root /usr/share/nginx/html; \
    } \
}' > /etc/nginx/conf.d/default.conf

# Set environment variables for runtime configuration
ENV VITE_API_URL=${API_URL} \
    VITE_WS_URL=${WS_URL}

# Expose port
EXPOSE 80

# Switch to non-root user
USER nginx

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl --fail http://localhost:80/ || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]

# Security options
SECURITY_OPTS --security-opt=no-new-privileges:true \
              --cap-drop=ALL \
              --cap-add=NET_BIND_SERVICE

# Set read-only root filesystem
VOLUME ["/etc/nginx/conf.d", "/var/cache/nginx"]
READONLY_ROOTFS true