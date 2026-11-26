import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type Rolldown } from "vite";

/**
 * The most the page may load before any route's own code, minified, in kB as Vite prints them: the entry chunk and the
 * chunks it imports, a little above their size once the page is split by route (447 kB). A change that brings a page's
 * code back into them fails the build, which says by how much.
 */
const entryBudgetKb = 470;

/** The chunk `fileName` and every chunk it imports statically, which the browser loads with it. */
function loadedWith(bundle: Rolldown.OutputBundle, fileName: string, loaded = new Set<string>()): Set<string> {
  const chunk = bundle[fileName];

  if (loaded.has(fileName) || chunk?.type !== "chunk") {
    return loaded;
  }

  loaded.add(fileName);

  for (const imported of chunk.imports) {
    loadedWith(bundle, imported, loaded);
  }

  return loaded;
}

/** Fails the build when an entry chunk, with the chunks it imports, is past `limitKb`. */
function entryBudget(limitKb: number): Plugin {
  return {
    name: "hangar:entry-budget",
    apply: "build",
    // After Vite's own hooks, which still rewrite the chunks' imports: the code measured is the code written.
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        for (const entry of Object.values(bundle)) {
          if (entry.type !== "chunk" || !entry.isEntry) {
            continue;
          }

          const loaded = [...loadedWith(bundle, entry.fileName)];
          const bytes = loaded.reduce((total, fileName) => {
            const chunk = bundle[fileName];

            return total + (chunk?.type === "chunk" ? Buffer.byteLength(chunk.code) : 0);
          }, 0);
          const sizeKb = bytes / 1000;

          if (sizeKb > limitKb) {
            this.error(
              `${entry.fileName} loads ${sizeKb.toFixed(2)} kB with the ${loaded.length - 1} chunks it imports, past the ` +
                `entry's budget of ${limitKb} kB (entryBudgetKb in vite.config.ts): import what it gained from a route's ` +
                "component, or raise the budget in the same change.",
            );
          }
        }
      },
    },
  };
}

export default defineConfig({
  plugins: [
    // Before React's plugin, as the router's asks. `tsr.config.json` says where the routes and their tree are, for the
    // plugin and `tsr generate` alike. Each route's components load with their page, the rest stays in the entry. Not
    // in the tests, whose pages would each wait for the first import of their chunk, past Testing Library's second:
    // the split is the build's, which the budget checks.
    tanstackRouter({ target: "react", autoCodeSplitting: process.env.VITEST === undefined }),
    tailwindcss(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    entryBudget(entryBudgetKb),
  ],
  // `.vite/manifest.json` names the files Vite hashed, which the server's `.page(..)` keeps a year.
  build: { manifest: true },
  server: {
    proxy: {
      // The server's `url` in the workspace's Cargo.toml, `[[workspace.metadata.quoll.server]]`: the two change together.
      "/api": "http://127.0.0.1:3011",
    },
  },
});
