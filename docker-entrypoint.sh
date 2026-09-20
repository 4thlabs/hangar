#!/bin/sh
set -e


# Migrations run before the server so a fresh volume gets its tables; `exec` keeps the server on
# PID 1 so it still receives signals.
node src/libs/db/utils/migrate.ts
exec node dist/serve-node.js
