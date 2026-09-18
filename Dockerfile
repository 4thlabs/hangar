FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Waku evaluates server modules during the build, so provide isolated build-time values.
# The auth secret is a disposable placeholder and is not copied into the runtime image.
# hadolint ignore=DL3064
ENV DOMAIN="example.com" \
    HANGAR_DATA_DIR=/tmp/hangar \
    HANGAR_DB_HOST=:memory: \
    HANGAR_STORE_URL=https://example.com/store.git \
    BETTER_AUTH_URL=http://localhost:3010 \
    BETTER_AUTH_SECRET=build-only-secret-at-least-32-characters

RUN npm run build

# The bundler leaves the native deps external (see waku.config.ts) and the job modules are plain
# TypeScript outside the bundle, so the runner needs real node_modules - production only.
RUN npm prune --omit=dev

FROM node:24-alpine AS runner

# Package versions are coupled to the Alpine base repository.
# hadolint ignore=DL3018
RUN apk add --no-cache docker-cli docker-cli-compose git

WORKDIR /app

# HANGAR_STORE_URL has no default on purpose: the store carries both the stacks
# and their categories, so it is the operator's own repository. Supply it at run
# time or the app refuses to start.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3010 \
    PUID=1000 \
    PGID=1000 \
    HANGAR_DATA_DIR=/app/data \
    HANGAR_DB_HOST=/app/data/app-data/hangar/hangar.db

COPY --from=builder --chown=${PUID}:${PGID} /app/dist ./dist
COPY --from=builder --chown=${PUID}:${PGID} /app/node_modules ./node_modules

# `manualJobResolution` makes the worker import `sidequest.jobs.js` at run time, which pulls the job
# classes straight from `src/` through the `#libs/*` map in package.json. All three must ship.
COPY --chown=${PUID}:${PGID} package.json sidequest.jobs.js ./
COPY --chown=${PUID}:${PGID} src ./src

# Docker seeds a fresh named volume from the image directory, ownership included. Without
# this the mount point is created root-owned and nothing the app writes under it - the
# database, the store - is permitted.
RUN mkdir -p /app/data && chown ${PUID}:${PGID} /app/data

USER ${PUID}:${PGID}

VOLUME ["/app/data"]
EXPOSE 3010

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["wget", "--quiet", "--spider", "http://127.0.0.1:3010/login"]

# Migrations run before the server so a fresh volume gets its tables; `exec` keeps the
# server on PID 1 so it still receives signals.
CMD ["sh", "-c", "node src/libs/db/utils/migrate.ts && exec node dist/serve-node.js"]
