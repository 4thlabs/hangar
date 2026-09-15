import "#libs/jobs/server"
import { MiddlewareHandler } from "hono/types"

export default () : MiddlewareHandler =>  {
    return async (c, next) => {
        await next();
    }
} 
