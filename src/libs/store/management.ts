import { exists, resolve, run } from "#libs/runtime";
import { config } from "./config.ts";
import path from "node:path";

/**
 * Install the store repository by cloning the store and creating symlinks
 */
export const install = async () => {
  const storePath = path.resolve(`${process.env.HANGAR_DATA_DIR}/store`);
  const installedPath = path.resolve(`${process.env.HANGAR_DATA_DIR}/app-installed`);

  if (!(await exists(storePath))) {
    return await run("git", "clone", config.store, storePath);
  }

  const stacks = resolve(true, "");

  for (const s of stacks) {
    try {
      const source = path.resolve(`${storePath}/${s}`);
      const dest = path.resolve(`${installedPath}/${s}`);

      if ((await exists(source)) && !(await exists(dest))) {
        await run("ln", "-s", source, dest);
      }
    } catch (ex) {
      console.error(`Failed to install ${s}`, ex);
    }
  }
};
