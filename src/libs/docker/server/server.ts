import "server-only";

/**
 * The Docker layer for the web server and the daemon events that keep it current, bound in
 * `#libs/services`.
 */
export { docker, dockerEvents } from "#libs/services/server";
