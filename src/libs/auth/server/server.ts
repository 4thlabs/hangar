import "server-only";
import { db } from "#libs/db/server";
import { createAuth } from "../auth.ts";
import { Sessions } from "../session.ts";

/** Better Auth for the web server, on the application database. */
export const auth = createAuth(db);

/** Session checks for the web server's requests. */
export const sessions = new Sessions(auth);
