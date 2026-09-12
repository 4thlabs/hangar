FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Waku evaluates server modules during the build, so provide isolated build-time values.
# The auth secret is a disposable placeholder and is not copied into the runtime image.
# hadolint ignore=DL3064
ENV HANGAR_DATA_DIR=/tmp/hangar \
    HANGAR_DB_HOST=/tmp/hangar/hangar.db \
    HANGAR_CONFIG_FILE=/app/config/hangar.yml \
    BETTER_AUTH_URL=http://localhost:3010 \
    BETTER_AUTH_SECRET=build-only-secret-at-least-32-characters

RUN npm run build

FROM node:24-alpine AS runner

# Package versions are coupled to the Alpine base repository.
# hadolint ignore=DL3018
RUN apk add --no-cache docker-cli docker-cli-compose git

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3010 \
    HANGAR_DATA_DIR=/app/data \
    HANGAR_DB_HOST=/app/data/hangar.db \
    HANGAR_CONFIG_FILE=/app/config/hangar.yml

COPY --from=builder --chown=node:node /app/dist ./dist

USER 1000:1000

VOLUME ["/app/data"]
EXPOSE 3010

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["wget", "--quiet", "--spider", "http://127.0.0.1:3010/login"]

CMD ["node", "dist/serve-node.js"]
