import type { MiddlewareHandler } from "hono/types";
import { sessions } from "#libs/auth/server";

/** better-auth's own routes, which set the session cookies themselves (sign-in, sign-out). */
const AUTH_ROUTES_PREFIX = "/api/auth/";

/**
 * Renews the session cookies on the response: a page or an API route checks the session through
 * `sessions.get`, which has no response to put them on. Without it, the cookie cache would lapse
 * `maxAge` after sign-in and every check would go back to the database.
 */
export default (): MiddlewareHandler =>
  async function sessionCookies(c, next) {
    const isAuthRoute = c.req.path.startsWith(AUTH_ROUTES_PREFIX);

    if (isAuthRoute || !c.req.header("Cookie")) {
      await next();

      return;
    }

    const renewedCookies = await sessions.renewedCookies(c.req.raw);

    await next();

    for (const cookie of renewedCookies) {
      c.res.headers.append("Set-Cookie", cookie);
    }
  };
