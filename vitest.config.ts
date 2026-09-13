import { config } from "dotenv";
import { defineConfig } from "vitest/config";

/**
 * Tests run against the committed `.env.test` fixture, never the developer's
 * `.env`: `src/libs/env` validates the environment at import time, so a missing
 * or machine-specific value fails the suite instead of the code under test.
 */
export default defineConfig({
  test: {
    env: config({ path: ".env.test" }).parsed ?? {},
  },
});
