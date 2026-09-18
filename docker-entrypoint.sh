#!/bin/sh
set -e

# The app drives the host's Docker socket, whose group is the host's own - 0 under Docker Desktop,
# usually a `docker` group on Linux. Carrying that group is what lets the process run as PUID:PGID
# and still reach the daemon; drop it and the socket closes. No socket means DOCKER_HOST points
# elsewhere, so there is nothing to join.
socket_group=$(stat -c %g /var/run/docker.sock 2>/dev/null || echo "${PGID}")
drop="setpriv --reuid=${PUID} --regid=${PGID} --groups=${PGID},${socket_group}"

# A fresh volume, or a bind mount from the host, arrives root-owned.
chown -R "${PUID}:${PGID}" /app/data

# Migrations run before the server so a fresh volume gets its tables; `exec` keeps the server on
# PID 1 so it still receives signals.
$drop node src/libs/db/utils/migrate.ts
exec $drop node dist/serve-node.js
