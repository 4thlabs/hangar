import { MiddlewareHandler } from "hono/types";
import { sidequestBoot } from "#libs/jobs/server";

export default (): MiddlewareHandler => sidequestBoot.middleware();
