import "server-only";

/**
 * The notification centre for the web server, bound in `#libs/services`, where a Sidequest job
 * gets its own through `createServices()`.
 */
export { notifications } from "#libs/services/server";
