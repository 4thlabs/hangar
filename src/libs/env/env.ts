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
  HANGAR_CONFIG_FILE: z.string().min(1),
  HANGAR_DATA_DIR: z.string().min(1),
  HANGAR_DB_HOST: z.string().min(1),
  DOMAIN: z.string().min(1),
  ARCANE_API_KEY: z.string().min(1).optional(),
  FRIGATE_API_URL: z.url().optional(),
  BETTER_AUTH_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
});

const parsed = envVariables.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map(issue => `  ${issue.path.join(".")}: ${issue.message}`).join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;

declare global {
  namespace NodeJS {
    interface ProcessEnv extends z.infer<typeof envVariables> {}
  }
}
