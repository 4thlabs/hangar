import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "waku/config";

// `dockerode` reaches a native `.node` binary through ssh2/cpu-features, which the bundler
// cannot read. It only ever runs on the server, so it stays external and is required at runtime.
const nativeDeps = ["node:sqlite", "node:path", "dockerode"];

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
