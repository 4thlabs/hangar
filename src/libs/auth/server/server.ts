import "server-only";
import { db } from "#libs/db/server";
import { terminals } from "#libs/terminals/server";
import { createAuth } from "../auth.ts";
import { Registration } from "../registration.ts";
import { Sessions } from "../session.ts";

/**
 * Better Auth for the web server, on the application database. Signing out ends the user's terminals: a kept
 * host shell, signed in over SSH, must not wait for whoever signs in to Hangar next.
 */
export const auth = createAuth(db, userId => terminals.closeAll(userId));

/** Session checks for the web server's requests. */
export const sessions = new Sessions(auth);

/** Whether the sign-up page still creates an account: only the first one. */
export const registration = new Registration(db);
