import { auth } from "#libs/auth/server";

/** better-auth's session reads and OAuth callbacks. */
export const GET = (request: Request) => auth.handler(request);

/** better-auth's sign-in, sign-up and sign-out. */
export const POST = (request: Request) => auth.handler(request);
