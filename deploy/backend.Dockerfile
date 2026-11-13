# syntax=docker/dockerfile:1
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --chown=node:node backend/package.json backend/package-lock.json ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node backend/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
