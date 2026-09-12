#!/usr/bin/env node

import module from "node:module";
import { cli } from "../src/cli/index.ts";

// https://nodejs.org/api/module.html#module-compile-cache
if (module.enableCompileCache && !process.env.NODE_DISABLE_COMPILE_CACHE) {
  try {
    module.enableCompileCache();
  } catch {
    // Ignore errors
  }
}

cli.parse();
