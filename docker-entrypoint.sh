#!/bin/sh
set -e

git config --global --add safe.directory ${HANGAR_DATA_DIR}/app-store

# Migrations run before the server so a fresh volume gets its tables; `exec` keeps the server on
# PID 1 so it still receives signals.
node src/libs/db/utils/migrate.ts
exec node dist/serve-node.js
