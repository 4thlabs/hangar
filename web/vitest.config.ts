import { defineConfig, mergeConfig } from "vitest/config";
import vite from "./vite.config.ts";

export default mergeConfig(
  vite,
  // `setup.ts` puts the tests' calls on msw's network (ADR 0002, decision 13).
  defineConfig({ test: { environment: "happy-dom", setupFiles: ["./src/mock/setup.ts"] } }),
);
