import { defineConfig } from "vitest/config";

/**
 * Tests run against the committed `.env.test` fixture, never the developer's
 * `.env`: `src/libs/env` validates the environment at import time, so a missing
 * or machine-specific value fails the suite instead of the code under test.
 */
export default defineConfig({
  test: {
    env: {
      HANGAR_DATA_DIR: "./.data",
      HANGAR_DB_HOST: ":memory:",
      HANGAR_CONFIG_FILE: "./config/hangar.yml",
      DOMAIN:"test.local",
      BETTER_AUTH_URL: "http://localhost:3010",
      BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long"
    },
  },
});
