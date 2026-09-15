import { sidequestBoot } from "#libs/jobs/server"
import { MiddlewareHandler } from "hono/types"

export default () : MiddlewareHandler => sidequestBoot();
