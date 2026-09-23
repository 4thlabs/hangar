import "dotenv/config";
import * as z from "zod";

/**
 * Every environment variable Hangar reads, validated once at import.
 *
 * Import this module (or `env`) instead of touching `process.env` directly:
 * a missing or malformed value must fail at startup with the variable named,
 * not halfway through a render as `https://arcane.undefined`.
 */
const envVariables = z.object({
  HANGAR_STORE_URL: z.string().min(1),
  HANGAR_DATA_DIR: z.string().min(1),
  HANGAR_DB_HOST: z.string().min(1),
  DOMAIN: z.string().min(1),
  GITHUB_TOKEN: z.string().min(1).optional(),
  BETTER_AUTH_URL: z.url().optional(),
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
});

const parsed = envVariables.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
}

export const env = parsed.data;

declare global {
  namespace NodeJS {
    interface ProcessEnv extends z.infer<typeof envVariables> {}
  }
}
