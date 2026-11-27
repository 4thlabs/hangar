import { readFile, writeFile } from "node:fs/promises";
import { defineConfig } from "orval";

/**
 * Turns the type check off in the MSW handlers of `files`, the files orval wrote: orval 8.49 spreads a string enum in
 * them, which TypeScript 7 refuses (TS2698), and its `header` option can only write a JSDoc block. Until orval fixes it
 * (ADR 0002, decision 13).
 */
async function withoutTypeCheck(files: unknown): Promise<void> {
  const written = Array.isArray(files) ? files.filter(file => typeof file === "string") : [];

  for (const file of written.filter(path => path.endsWith(".msw.ts"))) {
    const code = await readFile(file, "utf8");

    if (!code.startsWith("// @ts-nocheck")) {
      await writeFile(file, `// @ts-nocheck\n${code}`);
    }
  }
}

export default defineConfig({
  hangar: {
    // The document `cargo quoll gen` writes from `hangar-api`, the api's `output` seen from `web/`.
    input: "./openapi.json",
    output: {
      target: "./src/libs/api/generated.ts",
      client: "react-query",
      httpClient: "fetch",
      override: {
        mutator: { path: "./src/libs/api/api-fetch.ts", name: "apiFetch" },
        // The hooks' data is the body, which the mutator returns, not orval's `{ data, status, headers }`.
        fetch: { includeHttpResponseReturnType: false },
        // A key per path segment, `["api", "docker", "apps", project]`, so that a prefix invalidates a whole area
        // (ADR 0002, decision 2).
        query: { shouldSplitQueryKey: true },
      },
      // `generated.msw.ts`, beside: one MSW handler per operation, for the tests, through `#libs/api/mock` (ADR 0002,
      // decision 13).
      mock: { generators: [{ type: "msw" }] },
    },
    hooks: { afterAllFilesWrite: withoutTypeCheck },
  },
});
