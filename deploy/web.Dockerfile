FROM caddy:2-alpine
COPY frontend/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
