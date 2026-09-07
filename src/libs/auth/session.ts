import { unstable_getRequest, unstable_redirect } from 'waku/router/server';
import { auth } from './auth';

/**
 * The session for the request being handled.
 *
 * Not a React hook — server components have no hook to need. Waku keeps the
 * request in an AsyncLocalStorage that covers both a render and an API route
 * handler, so the same call works in either. Handlers that already hold the
 * request pass it in rather than reaching for the store.
 */
export const getSession = (request: Request = unstable_getRequest()) =>
  auth.api.getSession({ headers: request.headers });

/**
 * The session, or a redirect to /login. For pages: one line at the top of a
 * server component replaces its own signed-out branch.
 *
 * Not a middleware, on purpose. A client-side navigation fetches the page as
 * `/RSC/R/<route>.txt`, and an RSC payload is the only answer that transport
 * understands — a 3xx or a 401 from middleware reaches the router as a body it
 * cannot parse. `unstable_redirect` throws inside the render, so Waku turns it
 * into a 307 for a document and into the payload the router follows for a
 * navigation.
 *
 * A protected page must be `render: 'dynamic'` — a static one is prerendered
 * at build time and served before any of this runs.
 */
export const requireSession = async () => {
  const session = await getSession();
  if (!session) {
    unstable_redirect('/login');
  }
  return session;
};
