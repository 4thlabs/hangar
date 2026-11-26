import { defineConfig } from "orval";

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
      },
    },
  },
});
