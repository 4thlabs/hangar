import { defineConfig } from "@inlang/paraglide-js";

// Read by `paraglide-js compile` and by the Vite plugin. Every other option is Paraglide's default. The CLI defaults
// `outdir` to `./src/paraglide`, but the Vite plugin has no default for it.
export default defineConfig({
  outdir: "./src/paraglide",
});
