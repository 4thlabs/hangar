import "server-only";
import { unstable_getRequest, unstable_redirect } from "waku/router/server";
import { auth } from "./auth";

/** The session for the request being handled, in a render or an API route alike. */
export const getSession = (request: Request = unstable_getRequest()) =>
  auth.api.getSession({ headers: request.headers });

/**
 * The session, or a redirect to /login. Not a middleware: a client navigation only understands an
 * RSC payload, not a 3xx. The page must be `render: 'dynamic'`, or it is prerendered at build.
 */
export const requireSession = async () => {
  const session = await getSession();

  if (!session) {
    unstable_redirect("/login");
  }

  return session;
};
