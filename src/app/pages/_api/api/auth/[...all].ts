import { auth } from "#libs/auth";

/**
 * better-auth reads sessions and runs its OAuth callbacks here.
 */
export const GET = (request: Request) => auth.handler(request);

/**
 * Sign-in, sign-up and sign-out all land here.
 */
export const POST = (request: Request) => auth.handler(request);
