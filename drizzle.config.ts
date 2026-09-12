import { defineConfig } from "drizzle-kit";
import { env } from "./src/libs/env/index.ts";

export default defineConfig({
  out: "./src/drizzle",
  schema: ["./src/libs/db/schemas/auth-schema.ts"],
  dialect: "sqlite",
  dbCredentials: {
    url: env.HANGAR_DB_HOST,
  },
});
