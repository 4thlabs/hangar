import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "waku/config";

const nativeDeps = ["node:sqlite", "node:path"];

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
