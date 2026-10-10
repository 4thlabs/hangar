import { unstable_getRequest, unstable_redirect } from "waku/router/server";
import type { Auth } from "./auth.ts";

/**
 * Session checks for the request being handled.
 *
 * No import guard here: `server/server.ts`, which binds it, carries it (AGENTS.md).
 */
export class Sessions {
  private readonly auth: Auth;

  constructor(auth: Auth) {
    this.auth = auth;
  }

  /** The session for the request being handled, in a render or an API route alike. */
  get(request: Request = unstable_getRequest()) {
    return this.auth.api.getSession({ headers: request.headers });
  }

  /**
   * The session, or a redirect to /login. Not a middleware: a client navigation only understands an
   * RSC payload, not a 3xx. The page must be `render: 'dynamic'`, or it is prerendered at build.
   */
  async require() {
    const session = await this.get();

    if (!session) {
      unstable_redirect("/login");
    }

    return session;
  }

  /**
   * The `Set-Cookie` values that renew the session cookies of this request, if any are due. A check
   * made by {@link Sessions.get} drops them, so without this the cookie cache would only live for
   * its first `maxAge` after sign-in. Answered from the cookie cache while it is valid.
   */
  async renewedCookies(request: Request) {
    const { headers } = await this.auth.api.getSession({ headers: request.headers, returnHeaders: true });

    return headers.getSetCookie();
  }
}
