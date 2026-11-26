import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type Rolldown } from "vite";

/**
 * What a signed-in page loads before its own code, by the module each chunk starts from: the entry, which `index.html`
 * loads, and the component of `_app`, the frame every signed-in page is shown in. `/login` loads less.
 */
const firstLoad = ["index.html", "src/routes/_app.tsx?tsr-split=component"];

/**
 * The most `firstLoad` may weigh, minified, in kB as Vite prints them: their chunks, the chunks these import, and their
 * CSS, a little above their size once the page is split by route (758 kB). A change that brings a page's code into the
 * entry or the frame fails the build, which says by how much.
 */
const firstLoadBudgetKb = 790;

/** The chunk `fileName` and every chunk it imports statically, which the browser loads with it, added to `loaded`. */
function loadedWith(bundle: Rolldown.OutputBundle, fileName: string, loaded: Set<string>): Set<string> {
  const chunk = bundle[fileName];

  if (loaded.has(fileName) || chunk?.type !== "chunk") {
    return loaded;
  }

  loaded.add(fileName);

  for (const imported of chunk.imports) {
    loadedWith(bundle, imported, loaded);
  }

  for (const css of chunk.viteMetadata?.importedCss ?? []) {
    loaded.add(css);
  }

  return loaded;
}

/** The bytes of the chunk or asset `fileName` of `bundle`. */
function bytesOf(bundle: Rolldown.OutputBundle, fileName: string): number {
  const file = bundle[fileName];

  if (file === undefined) {
    return 0;
  }

  if (file.type === "chunk") {
    return Buffer.byteLength(file.code);
  }

  return typeof file.source === "string" ? Buffer.byteLength(file.source) : file.source.byteLength;
}

/**
 * Fails the build when the chunks of `modules`, paths from Vite's root, weigh more than `limitKb` with the chunks they
 * import and their CSS. A module with no chunk of its own, renamed or merged into another, fails it too: the budget
 * would no longer count it.
 */
function firstLoadBudget(modules: readonly string[], limitKb: number): Plugin {
  let root = "";

  return {
    name: "hangar:first-load-budget",
    apply: "build",
    configResolved(config) {
      root = config.root;
    },
    // After Vite's own hooks, which still rewrite the chunks' imports: the code measured is the code written.
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        const loaded = new Set<string>();

        for (const module of modules) {
          const chunk = Object.values(bundle).find(
            file => file.type === "chunk" && file.facadeModuleId === `${root}/${module}`,
          );

          if (chunk === undefined) {
            this.error(
              `no chunk starts from ${module}, which firstLoad in vite.config.ts names: say what replaced it.`,
            );
          }

          loadedWith(bundle, chunk.fileName, loaded);
        }

        const sizeKb = [...loaded].reduce((total, fileName) => total + bytesOf(bundle, fileName), 0) / 1000;

        if (sizeKb > limitKb) {
          this.error(
            `a signed-in page loads ${sizeKb.toFixed(2)} kB before its own code, in ${loaded.size} files, past its ` +
              `budget of ${limitKb} kB (firstLoadBudgetKb in vite.config.ts): import what it gained from a route's ` +
              "component, or raise the budget in the same change.",
          );
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
    firstLoadBudget(firstLoad, firstLoadBudgetKb),
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
