# syntax=docker/dockerfile:1

# The Rust binary `hangar`, for `docker exec -it hangar hangar store up`. Alpine's Rust targets musl, which links it
# statically: the same binary as the release's, built for the platform of the image. cargo-chef builds the dependencies
# in a layer of their own, which the registry cache keeps until Cargo.lock or a manifest changes.
FROM rust:1-alpine AS chef

# Package versions are coupled to the Alpine base repository.
# hadolint ignore=DL3018
RUN apk add --no-cache musl-dev
RUN cargo install cargo-chef --locked --version 0.1.78

WORKDIR /src

FROM chef AS planner

COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS cli

COPY --from=planner /src/recipe.json ./
RUN cargo chef cook --release --locked -p hangar-cli --recipe-path recipe.json

COPY Cargo.toml Cargo.lock ./
COPY crates ./crates

# The tag of a release, which the binary prints for `--version`: CI passes it on a `v*` tag alone.
ARG HANGAR_VERSION=""
RUN cargo build --release --locked -p hangar-cli \
    && cp target/release/hangar /usr/local/bin/hangar

FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Without the Rust workspace, which the `cli` stage builds: a Rust-only commit leaves the Waku build cached.
COPY --exclude=crates --exclude=Cargo.toml --exclude=Cargo.lock . .

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
    HOME=/app/data \
    HANGAR_DATA_DIR=/app/data

ENV HANGAR_DB_HOST=${HANGAR_DATA_DIR}/app-data/hangar/hangar.db

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

# `manualJobResolution` makes the worker import `sidequest.jobs.js` at run time, which pulls the job
# classes straight from `src/` through the `#libs/*` map in package.json. All three must ship.
COPY package.json sidequest.jobs.js ./
COPY src ./src
COPY --chmod=755 docker-entrypoint.sh /
COPY --from=cli /usr/local/bin/hangar /usr/local/bin/hangar

VOLUME ["/app/data"]

EXPOSE 3010

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["wget", "--quiet", "--spider", "http://127.0.0.1:3010/login"]

# Runs as root; PUID:PGID are passed through to the stacks - see the entrypoint.
ENTRYPOINT ["/docker-entrypoint.sh"]
