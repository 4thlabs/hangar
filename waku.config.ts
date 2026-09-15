import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "waku/config";

// `better-sqlite3` and `dockerode` (via ssh2/cpu-features) load native `.node` binaries the bundler
// cannot read. They only ever run on the server, so they stay external and are required at runtime.
const nativeDeps = ["better-sqlite3", "node:path", "dockerode"];

export default defineConfig({
  srcDir: "src/app",
  vite: {
    resolve: { tsconfigPaths: true },
    optimizeDeps: { exclude: nativeDeps },
    plugins: [tailwindcss(), react(), babel({ presets: [reactCompilerPreset()] })],
    environments: {
      rsc: { resolve: { external: nativeDeps } },
      ssr: { resolve: { external: nativeDeps } },
    },
  },
});
