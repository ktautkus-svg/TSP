FROM node:24-alpine AS build
# Force a new image after revision 00177 failed on an unresolved @/ import.
WORKDIR /app
COPY package.json package-lock.json ./
# npm ci vykdo postinstall, todėl šis scenarijus turi būti konteineryje dar
# prieš kopijuojant likusį projekto kodą.
COPY scripts/sync-leaflet-css.mjs ./scripts/sync-leaflet-css.mjs
RUN npm ci
COPY . .
RUN if [ -f .env.docker ]; then tr -d '\r' < .env.docker > .env; fi && \
    if [ -f .env ]; then tr -d '\r' < .env > .env.clean && mv .env.clean .env && set -a && . ./.env && set +a; fi && \
    npm run pwa:build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    INTERNAL_GATEWAY_PORT=8788 \
    GATEWAY_ENV=production \
    GATEWAY_AUTH_MODE=none
COPY --from=build /app/build-server ./build-server
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/scripts/august-2026-backfill ./scripts/august-2026-backfill
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:${PORT}/health || exit 1
CMD ["node", "build-server/server/production-server.js"]
